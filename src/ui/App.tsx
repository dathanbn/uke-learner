import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalibrationOutcome } from '../audio/calibration';
import { AudioEngine, type MicStatus } from '../audio/engine';
import { SpeedModel } from '../srs/grading';
import { buildDeck, buildTransitions, knownShapes, Scheduler } from '../srs/scheduler';
import { Session } from '../srs/session';
import { EMPTY_STREAK, recordPractice, type StreakState } from '../srs/streak';
import type { Card, PresentationType, ReviewLog, SessionSettings } from '../srs/types';
import { DEFAULT_SETTINGS } from '../srs/types';
import { Store } from '../store/db';
import { DebugPage } from './DebugPage';
import { HomeScreen } from './HomeScreen';
import { SessionScreen } from './SessionScreen';
import { SettingsScreen } from './SettingsScreen';
import { SummaryScreen } from './SummaryScreen';
import { TunerPanel } from './TunerPanel';
import './theme.css';

type Screen = 'home' | 'calibrate' | 'session' | 'summary' | 'debug' | 'settings';

const SECONDS_PER_CARD: [PresentationType, number][] = [
  ['name_to_play', 8],
  ['diagram_to_play', 8],
  ['ear_to_play', 10],
  ['transition', 12],
];

export function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [settings, setSettings] = useState<SessionSettings>(DEFAULT_SETTINGS);
  const [cards, setCards] = useState<Card[]>([]);
  const [store, setStore] = useState<Store | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micStatus, setMicStatus] = useState<MicStatus | null>(null);
  const [calibration, setCalibration] = useState<CalibrationOutcome | null>(null);
  const [lastLogs, setLastLogs] = useState<readonly ReviewLog[]>([]);
  const [streak, setStreak] = useState<StreakState>(EMPTY_STREAK);

  const engineRef = useRef<AudioEngine | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const speedRef = useRef(new SpeedModel(2500));

  // Load or seed the deck. Everything is local — no account, no network.
  useEffect(() => {
    void (async () => {
      try {
        const s = await Store.open();
        setStore(s);
        const loaded = await s.settings();
        setSettings(loaded);
        let existing = await s.allCards();
        if (existing.length === 0) {
          existing = buildDeck(new Scheduler(loaded.requestRetention), loaded);
          await s.putCards(existing);
        }
        setCards(existing);
        const samples = await s.getMeta<number[]>('speedSamples');
        if (samples) speedRef.current = SpeedModel.fromJSON(samples);
        setStreak((await s.getMeta<StreakState>('streak')) ?? EMPTY_STREAK);
      } catch {
        // A private window with storage blocked shouldn't stop someone practising —
        // they just won't keep their progress.
        setCards(buildDeck(new Scheduler(DEFAULT_SETTINGS.requestRetention), DEFAULT_SETTINGS));
      }
    })();
  }, []);

  const persistSettings = useCallback(
    (s: SessionSettings) => {
      setSettings(s);
      void store?.saveSettings(s);
      // A live session should follow a setting change immediately rather than at the next
      // session — someone reaching for the leniency slider is doing it because the current
      // card just failed.
      engineRef.current?.configure(s.tuningId, s.sensitivity);
    },
    [store],
  );

  /**
   * Widening the tier adds cards for chords that weren't in the deck before. Without this
   * the setting appears to do nothing until the database is wiped.
   */
  const syncDeck = useCallback(
    async (s: SessionSettings) => {
      const scheduler = new Scheduler(s.requestRetention);
      const wanted = [
        ...buildDeck(scheduler, s),
        // Unlocked progressively: a transition only appears once both its chords are
        // themselves solid, so the drill is the change rather than the shapes.
        ...buildTransitions(scheduler, s, knownShapes(cards)),
      ];
      const have = new Set(cards.map((c) => c.id));
      const missing = wanted.filter((c) => !have.has(c.id));
      if (missing.length === 0) return;
      setCards([...cards, ...missing]);
      await store?.putCards(missing);
    },
    [cards, store],
  );

  const eraseAll = useCallback(async () => {
    await store?.eraseAll();
    const scheduler = new Scheduler(DEFAULT_SETTINGS.requestRetention);
    const deck = buildDeck(scheduler, DEFAULT_SETTINGS);
    setSettings(DEFAULT_SETTINGS);
    setCards(deck);
    setStreak(EMPTY_STREAK);
    await store?.putCards(deck);
    setScreen('home');
  }, [store]);

  const beginCalibration = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const engine = new AudioEngine();
      engineRef.current = engine;
      const status = await engine.start({
        onCalibration: (o) => {
          setCalibration(o);
          // Move the detector onto this instrument's actual tuning. A uniformly flat uke
          // is in tune with itself, so there is nothing for the learner to fix.
          if (o.kind === 'in_tune' || o.kind === 'auto_adjusted') {
            engine.setReferenceOffset(o.offsetCents);
          }
        },
      });
      setMicStatus(status);
      setScreen('calibrate');
      engine.configure(settings.tuningId, settings.sensitivity);
      engine.calibrate(settings.tuningId);
    } catch (e) {
      setError(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Microphone access was denied. The app needs it to hear your ukulele — there is no other way for cards to advance on their own.'
          : 'Could not open the microphone.',
      );
    } finally {
      setBusy(false);
    }
  }, [settings.tuningId, settings.sensitivity]);

  const startSession = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const scheduler = new Scheduler(settings.requestRetention);
    const session = new Session(scheduler, settings, speedRef.current, new Map(SECONDS_PER_CARD));
    const introduced = (await store?.newIntroducedToday()) ?? 0;
    session.plan(cards, introduced);
    sessionRef.current = session;
    setScreen('session');
  }, [cards, settings, store]);

  const finishSession = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    let updated = cards.map((c) => session.updated.get(c.id) ?? c);

    // Chords that became solid during this session may have unlocked new transitions.
    const scheduler = new Scheduler(settings.requestRetention);
    const have = new Set(updated.map((c) => c.id));
    const unlocked = buildTransitions(scheduler, settings, knownShapes(updated)).filter(
      (c) => !have.has(c.id),
    );
    if (unlocked.length) {
      updated = [...updated, ...unlocked];
      await store?.putCards(unlocked);
    }
    setCards(updated);
    setLastLogs(session.logs);
    await store?.putCards([...session.updated.values()]);
    await store?.appendReviews(session.logs);
    await store?.setMeta('speedSamples', speedRef.current.toJSON());

    // A session only counts toward the streak if something was actually reviewed —
    // opening the app and immediately quitting shouldn't keep a streak alive.
    if (session.logs.length > 0) {
      const nextStreak = recordPractice(streak);
      setStreak(nextStreak);
      await store?.setMeta('streak', nextStreak);
    }
    await engineRef.current?.stop();
    engineRef.current = null;
    sessionRef.current = null;
    setScreen('summary');
  }, [cards, store, settings, streak]);

  const goHome = useCallback(async () => {
    await engineRef.current?.stop();
    engineRef.current = null;
    setCalibration(null);
    setMicStatus(null);
    setScreen('home');
  }, []);

  useEffect(() => () => void engineRef.current?.stop(), []);

  if (screen === 'debug') return <DebugPage onBack={goHome} />;

  if (screen === 'settings') {
    return (
      <SettingsScreen
        settings={settings}
        store={store}
        onChange={(s) => {
          persistSettings(s);
          void syncDeck(s);
        }}
        onBack={() => setScreen('home')}
        onReset={() => void eraseAll()}
      />
    );
  }

  if (screen === 'session' && sessionRef.current && engineRef.current) {
    return (
      <SessionScreen
        session={sessionRef.current}
        engine={engineRef.current}
        onFinish={() => void finishSession()}
      />
    );
  }

  if (screen === 'summary') {
    return (
      <SummaryScreen logs={lastLogs} cards={cards} streak={streak} onHome={() => void goHome()} />
    );
  }

  if (screen === 'calibrate') {
    const ready = calibration?.kind === 'in_tune' || calibration?.kind === 'auto_adjusted';
    return (
      <div className="app">
        <h1>Let's hear your ukulele</h1>
        <p>Strum all four strings once, fairly firmly.</p>

        {micStatus && !micStatus.rawAudio ? (
          <div className="banner bad">
            Your browser is applying voice processing to the microphone despite being asked
            not to. It's tuned for speech and will mangle the sound of the instrument, so
            detection may be unreliable. Another browser will work better.
          </div>
        ) : null}
        {micStatus?.warning ? <div className="banner warn">{micStatus.warning}</div> : null}

        <TunerPanel
          outcome={calibration}
          listening
          onRecalibrate={() => {
            setCalibration(null);
            engineRef.current?.calibrate(settings.tuningId);
          }}
        />

        <div className="row spread">
          <button onClick={() => void goHome()}>Back</button>
          <button className="primary" onClick={() => void startSession()} disabled={!ready}>
            {ready ? 'Start practising' : 'Waiting for a strum…'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {error ? (
        <div className="app" style={{ paddingBottom: 0 }}>
          <div className="banner bad">{error}</div>
        </div>
      ) : null}
      <HomeScreen
        settings={settings}
        cards={cards}
        streak={streak}
        onSettings={persistSettings}
        onStart={() => void beginCalibration()}
        onDebug={() => setScreen('debug')}
        onOpenSettings={() => setScreen('settings')}
        busy={busy}
      />
    </>
  );
}
