import { useEffect, useMemo, useRef, useState } from 'react';
import type { AudioEngine } from '../audio/engine';
import { describeDiagnosis } from '../audio/verdict';
import { getShape } from '../music/shapes';
import type { Session } from '../srs/session';
import { shapeName } from '../srs/scheduler';
import { SmoothedEstimate } from '../srs/session';
import type { Verdict } from '../types';
import { ChordDiagram } from './ChordDiagram';
import { useSessionMachine } from './useSessionMachine';

const fmt = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * The practice loop.
 *
 * Everything here is designed to be operated with both hands on the instrument. Buttons
 * exist, but they are the fallback path, not the primary one — the moment a learner has to
 * put the ukulele down to press something, the product's whole premise is gone.
 */
export function SessionScreen({
  session,
  engine,
  onFinish,
}: {
  session: Session;
  engine: AudioEngine;
  onFinish: () => void;
}) {
  const machine = useSessionMachine();
  const [snapshot, setSnapshot] = useState(() => session.snapshot());
  const [lastVerdict, setLastVerdict] = useState<Verdict | null>(null);
  const smoother = useRef(new SmoothedEstimate(2));
  const [shownEstimate, setShownEstimate] = useState(0);

  const card = snapshot.current;
  const shape = useMemo(() => (card ? getShape(card.shapeId) : null), [card]);

  // Route verdicts into the state machine. The engine is told which shape to score
  // against; changing cards resets detection so a ringing chord can't leak across.
  useEffect(() => {
    engine.setTarget(card?.shapeId ?? null);
    engine.resetDetection();
    machine.newCard();
    setLastVerdict(null);
  }, [card?.id, engine]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    engine.setHandlers({
      onVerdict: (v) => {
        setLastVerdict(v.verdict);
        machine.submitVerdict(v.verdict);
      },
    });
  }, [engine, machine]);

  // Once graded, record the answer and move on.
  useEffect(() => {
    if (machine.state.phase !== 'graded' || !machine.state.outcome) return;
    session.answer(machine.state.outcome);
    const next = session.snapshot();
    setSnapshot(next);
    if (session.isFinished()) onFinish();
  }, [machine.state.phase, machine.state.outcome, session, onFinish]);

  // Tick the clock. The estimate is smoothed upward so it never appears to go backwards.
  useEffect(() => {
    const id = setInterval(() => {
      const snap = session.snapshot();
      setSnapshot(snap);
      setShownEstimate(smoother.current.update(snap.estimatedSecondsLeft));
      if (session.isFinished()) onFinish();
    }, 1000);
    return () => clearInterval(id);
  }, [session, onFinish]);

  // Keep the screen awake — a hands-free drill where the display sleeps is not hands-free.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    void navigator.wakeLock
      ?.request('screen')
      .then((l) => {
        if (cancelled) void l.release();
        else lock = l;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      void lock?.release().catch(() => undefined);
    };
  }, []);

  if (!card || !shape) return null;

  const { phase, message } = machine.state;
  const reveal = phase === 'reveal';
  const showDiagram = reveal || card.presentation === 'diagram_to_play';
  const progress =
    snapshot.reviewed + snapshot.remaining > 0
      ? (snapshot.reviewed / (snapshot.reviewed + snapshot.remaining)) * 100
      : 0;

  return (
    <div className="app">
      <div className="meter" style={{ marginBottom: 8 }}>
        <i style={{ width: `${progress}%` }} />
      </div>
      <div className="row spread muted" style={{ marginBottom: 24, fontSize: 13 }}>
        <span>
          {snapshot.reviewed} done · {snapshot.remaining} to go
        </span>
        <span>about {fmt(shownEstimate)} left</span>
      </div>

      <div className="card" style={{ textAlign: 'center', padding: '36px 20px' }}>
        <div className="muted" style={{ marginBottom: 6 }}>
          {reveal ? 'Here it is — play this' : phase === 'retry' ? 'Try once more' : 'Play'}
        </div>

        {showDiagram ? (
          <ChordDiagram shape={shape} size={190} />
        ) : (
          <div style={{ fontSize: 68, fontWeight: 800, letterSpacing: '-0.03em' }}>
            {shapeName(card)}
          </div>
        )}

        {phase === 'retry' && lastVerdict?.kind === 'incorrect' ? (
          <div className="banner bad" style={{ marginTop: 20, textAlign: 'left' }}>
            {lastVerdict.perString
              .map(describeDiagnosis)
              .filter((s): s is string => s !== null)
              .slice(0, 2)
              .map((s) => (
                <div key={s}>{s}</div>
              ))}
          </div>
        ) : null}

        {message ? (
          <div className="banner warn" style={{ marginTop: 20 }}>
            {message}
          </div>
        ) : null}

        {reveal ? (
          <p className="muted" style={{ marginTop: 16, marginBottom: 0 }}>
            Play it as shown and we'll move on. No penalty for taking a moment.
          </p>
        ) : null}
      </div>

      <div className="row spread">
        <button onClick={onFinish}>End session</button>
        {machine.offerOverride ? (
          <button onClick={machine.override}>I played that right</button>
        ) : (
          <span className="muted" style={{ fontSize: 13 }}>
            Keep your hands on the uke — it advances by itself.
          </span>
        )}
      </div>
    </div>
  );
}
