# Architecture, hosting, and limitations

## Short answer to "do I need a backend?"

**No. Not for v1, and possibly not ever.**

Everything this app does happens on the user's device:

| Capability | Where it runs | Needs a server? | Needs an API key? |
| --- | --- | --- | --- |
| Microphone capture | Web Audio API, in the browser | No | No |
| Chord detection / DSP | AudioWorklet + Worker | No | No |
| Tuner | Same audio pipeline | No | No |
| FSRS scheduling | `ts-fsrs`, in the browser | No | No |
| Card / review storage | IndexedDB | No | No |
| Chord + deck data | Static JSON in the bundle | No | No |
| Offline use | Service worker (PWA) | No | No |

There is no cloud speech service, no ML inference endpoint, no paid audio API. The Web
Audio API is a free browser primitive. This is unusual and it is worth appreciating: the
expensive-sounding part of your product is the free part.

## Recommended stack

```
Vite + React 18 + TypeScript
├── audio/     AudioWorklet processor, FFT, note activation, onset, verdict scorer
├── srs/       ts-fsrs wrapper, learning queue, session budgeter
├── data/      chord shapes, tunings, decks (static JSON, versioned)
├── store/     IndexedDB via idb or Dexie
└── ui/        React components, CSS custom properties for theming
```

- **Vite** — fast, first-class Web Worker and AudioWorklet support, trivial static build.
- **TypeScript** — non-negotiable for the audio layer; MIDI numbers, frequencies, cents,
  and fret numbers are all `number` and you *will* mix them up. Use branded types.
- **`ts-fsrs`** — the scheduler. See `docs/SCHEDULER.md`.
- **IndexedDB, not localStorage** — review logs grow without bound and localStorage caps at
  ~5 MB and is synchronous (it will jank your audio loop).
- **No state-management library** to start. The app is one session state machine.

## Hosting: GitHub Pages works

GitHub Pages is a genuinely correct choice here, not a compromise.

**Why it works:**
- Serves over **HTTPS**, which `getUserMedia` requires. This is the only hard hosting
  requirement the app has.
- Static-only is fine because the app is static.
- Free, with a 1 GB site limit and ~100 GB/month soft bandwidth — the bundle will be a few
  hundred KB, so this is effectively unlimited for this use case.
- Custom domains supported, with automatic certs.

**Watch out for:**
- **Base path.** A project site serves from `/<repo>/`. Set `base: '/uke-learner/'` in
  `vite.config.ts` or every asset 404s. This is the #1 GitHub Pages deploy bug.
- **SPA routing.** No server-side rewrites. Use hash routing, or the `404.html` copy trick.
- **Free-plan Pages requires a public repo** (or GitHub Pro for private). Given the
  positioning, public is the right call anyway.
- **Deploy via Actions**, not the legacy branch mode — `actions/deploy-pages` with a build
  step is the current path.

Cloudflare Pages and Netlify are equally fine and give you nicer preview deploys per PR,
which is worth something when iterating on audio with a phone in your hand.

## When you would actually need a server

You need one only for things that are inherently multi-device or multi-user:

| Want | Needs a server | Cheapest path |
| --- | --- | --- |
| Sync progress across phone + laptop | Yes | Supabase or Firebase — auth + DB, nothing to operate |
| Accounts / login | Yes | Same |
| Leaderboards, friends, shared streaks | Yes | Same |
| Paid subscriptions | Yes | Stripe + a webhook handler (Cloudflare Worker) |
| Aggregate analytics on detection accuracy | Yes | A single Worker endpoint + a table |
| Push detector-threshold updates without redeploy | No, but nice | A JSON config fetched at load |
| Shared/importable decks | **No** | Deck = a JSON file. A GitHub repo or a gist is the "server". |

**Build it local-first regardless.** IndexedDB stays the source of truth; the server is a
sync target, not a dependency. Give every card a `updatedAt` and resolve conflicts
last-write-wins per card (review logs are append-only, so they merge trivially by
`(cardId, ts)`). This keeps the app working offline, keeps the audio loop off the network,
and means a server outage never blocks practice.

Realistic cost if you add sync: **$0/month** on Supabase's or Firebase's free tier until
you have thousands of users.

## About API keys

The core app needs **none**. Two future features would:

- **AI explanations** ("why does F sound sad here?", auto-generating practice decks from a
  song) — would use the Anthropic API and need a key.
- **Song chord lookup** from a third-party service.

If you add either: **an API key can never live in a static site.** Anything in a Vite
bundle — including `VITE_*` env vars — ships to the browser in plain text and is public
the moment you deploy. The only correct pattern is a tiny proxy (a Cloudflare Worker, ~30
lines) that holds the key server-side and forwards requests. Budget for rate limiting on
that proxy from day one, because a public endpoint spending your API credits will be found.

## Browser and platform limitations

**Audio**
- `AudioContext` must be created or resumed inside a user gesture, especially on iOS Safari.
  Build the flow around a "tap to start listening" button.
- Browser voice processing (echo cancellation, noise suppression, AGC) must be explicitly
  disabled — see `docs/AUDIO_ENGINE.md`. Some browsers ignore the constraint; check
  `track.getSettings()` and warn.
- Mobile input latency is meaningfully worse than desktop. Test on a real phone early.
- Bluetooth mics (AirPods) are mono, heavily processed, and high-latency. Detect and warn.
- Only one tab can have a good grip on the mic; a second tab or a video call will fight you.

**Mobile / PWA**
- The screen will sleep during hands-free play. Use the **Screen Wake Lock API** (widely
  supported now, but have a fallback message).
- iOS PWA support for `getUserMedia` has historically been inconsistent; verify on the
  actual iOS version you care about before promising an installable app.
- Continuous FFT plus wake lock is a real battery draw. Keep sessions short — which the
  product design already does.

**Product-level limitations to be honest about**
- **The app cannot see your hands.** Two fingerings that produce the same notes are
  acoustically identical, so it validates the *sound*, not the *technique*. A user could
  build a bad habit the app will happily approve. Show the diagram, and say this plainly
  somewhere in onboarding.
- **Chord names are ambiguous on ukulele** (C6 = Am7). Fine for "play this chord" cards;
  a genuine wall for any future "name this chord" ear-training mode.
- **Detection will never be 100 %.** Ship the manual override, a sensitivity slider, and a
  "this chord keeps failing" report path. Treat false accepts as worse than false rejects:
  approving a wrong shape teaches the wrong shape.
- **SRS doesn't replace playing music.** Spacing consolidates recall; fluency needs volume
  and songs. Position accordingly (`docs/MARKET_RESEARCH.md`) and consider ending each
  session with "here are 3 songs you can now play with the chords you know."
- **Content and legal.** Chord names, fingerings, and diagrams are facts and not
  copyrightable — safe. Song lyrics and tablature are not. Do not ship song content.
- **Cold-start effort.** ~40 chord shapes plus a labelled audio corpus per chord is a real
  content task, and the audio corpus needs *you, with a ukulele, recording takes.* This is
  the least automatable part of the project. Start recording early.

## Build order (risk-first)

1. **Audio spike** — a debug page showing live note activations and a verdict against one
   hard-coded chord. If this doesn't feel good, nothing else matters.
2. **Eval harness + fixture corpus** — before tuning any threshold.
3. **Scheduler** — `ts-fsrs`, learning queue, IndexedDB, tested headlessly with no audio.
4. **Session UI** — the hands-free loop, timer, estimated time remaining.
5. **Tuner / calibration.**
6. **PWA, deploy, polish.**

Steps 1 and 2 are the project. Steps 3–6 are ordinary web development.
