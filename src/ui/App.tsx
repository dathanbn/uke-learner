import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalibrationOutcome } from '../audio/calibration';
import { AudioEngine, type MicStatus } from '../audio/engine';
import { SpeedModel } from '../srs/grading';
import { buildDeck, Scheduler } from '../srs/scheduler';
import { Session } from '../srs/session';
import type { Card, PresentationType, ReviewLog, SessionSettings } from '../srs/types';
import { DEFAULT_SETTINGS } from '../srs/types';
import { Store } from '../store/db';
import { DebugPage } from './DebugPage';
import { HomeScreen } from './HomeScreen';
import { SessionScreen } from './SessionScreen';
import { SummaryScreen } from './SummaryScreen';
import { TunerPanel } from './TunerPanel';
import './theme.css';

type Screen = 'home' | 'calibrate' | 'session' | 'summary' | 'debug';

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
    },
    [store],
  );

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
  }, [settings.tuningId]);

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
    const updated = cards.map((c) => session.updated.get(c.id) ?? c);
    setCards(updated);
    setLastLogs(session.logs);
    await store?.putCards([...session.updated.values()]);
    await store?.appendReviews(session.logs);
    await store?.setMeta('speedSamples', speedRef.current.toJSON());
    await engineRef.current?.stop();
    engineRef.current = null;
    sessionRef.current = null;
    setScreen('summary');
  }, [cards, store]);

  const goHome = useCallback(async () => {
    await engineRef.current?.stop();
    engineRef.current = null;
    setCalibration(null);
    setMicStatus(null);
    setScreen('home');
  }, []);

  useEffect(() => () => void engineRef.current?.stop(), []);

  if (screen === 'debug') return <DebugPage onBack={goHome} />;

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
    return <SummaryScreen logs={lastLogs} cards={cards} onHome={() => void goHome()} />;
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
        onSettings={persistSettings}
        onStart={() => void beginCalibration()}
        onDebug={() => setScreen('debug')}
        busy={busy}
      />
    </>
  );
}
