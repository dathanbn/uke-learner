import { useEffect, useMemo, useRef, useState } from 'react';
import type { AudioEngine } from '../audio/engine';
import { describeDiagnosis } from '../audio/verdict';
import { getShape } from '../music/shapes';
import type { Session } from '../srs/session';
import { shapeName } from '../srs/scheduler';
import { SmoothedEstimate } from '../srs/session';
import type { Verdict } from '../types';
import { ChordDiagram } from './ChordDiagram';
import { announce, useSessionMachine } from './useSessionMachine';

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
  const toShape = useMemo(() => (card?.toShapeId ? getShape(card.toShapeId) : null), [card]);
  const isTransition = card?.presentation === 'transition' && toShape !== null;

  const { newCard, submitVerdict } = machine;
  const { leg } = machine.state;

  /** For a transition, the chord the detector should currently be listening for. */
  const activeShapeId =
    isTransition && leg === 'second' ? (card?.toShapeId ?? null) : (card?.shapeId ?? null);

  // Reset for each presentation. Keyed on presentationKey, not the card id: the same card
  // can legitimately be shown twice in a row once the queue drains into the learning
  // queue, and keying on the id would leave the machine stuck in its graded phase with a
  // card on screen that never advances.
  useEffect(() => {
    engine.resetDetection();
    newCard(isTransition);
    setLastVerdict(null);
  }, [snapshot.presentationKey, card?.shapeId, engine, newCard, isTransition]);

  // Retarget as the transition advances. Deliberately does NOT reset detection: the gap
  // between the two chords is the thing this card measures, so dropping onsets in between
  // would measure something else.
  useEffect(() => {
    engine.setTarget(activeShapeId);
  }, [engine, activeShapeId]);

  useEffect(() => {
    engine.setHandlers({
      onVerdict: (v) => {
        setLastVerdict(v.verdict);
        submitVerdict(v.verdict);
      },
    });
  }, [engine, submitVerdict]);

  const onSetAside = () => {
    session.setAside();
    const next = session.snapshot();
    setSnapshot(next);
    if (session.isFinished()) onFinish();
  };

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
  const label = shapeName(card);
  const showDiagram = reveal || card.presentation === 'diagram_to_play';
  const activeShape = isTransition && leg === 'second' && toShape ? toShape : shape;
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
          {reveal
            ? 'Here it is — play this'
            : isTransition
              ? leg === 'first'
                ? 'Play the first chord, then change'
                : 'Now change'
              : phase === 'retry'
                ? 'Try once more'
                : 'Play'}
        </div>

        {isTransition && toShape ? (
          // Both chords stay on screen throughout. The one being waited for is highlighted
          // rather than swapped in: seeing where you're going is the point of the drill.
          <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
            <div style={{ opacity: leg === 'first' ? 1 : 0.35 }}>
              {showDiagram ? (
                <ChordDiagram shape={shape} size={140} />
              ) : (
                <div style={{ fontSize: 46, fontWeight: 800 }}>{shape.name}</div>
              )}
            </div>
            <div className="muted" style={{ fontSize: 30 }} aria-hidden="true">
              →
            </div>
            <div style={{ opacity: leg === 'second' ? 1 : 0.35 }}>
              {showDiagram ? (
                <ChordDiagram shape={toShape} size={140} />
              ) : (
                <div style={{ fontSize: 46, fontWeight: 800 }}>{toShape.name}</div>
              )}
            </div>
          </div>
        ) : showDiagram ? (
          <ChordDiagram shape={activeShape ?? shape} size={190} />
        ) : (
          <div style={{ fontSize: 68, fontWeight: 800, letterSpacing: '-0.03em' }}>
            {shapeName(card)}
          </div>
        )}

        {isTransition && machine.state.transitionMs !== null ? (
          <div className="pill ok" style={{ marginTop: 16, display: 'inline-block' }}>
            changed in {(machine.state.transitionMs / 1000).toFixed(1)}s
          </div>
        ) : null}

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

      {/* The verdict is conveyed visually by colour, a mark and text; this carries the
          same information to a screen reader without stealing focus. */}
      <p aria-live="polite" className="sr-only">
        {announce(machine.state, label)}
      </p>

      <div className="row spread">
        <button onClick={onFinish}>End session</button>
        <div className="row">
          {machine.offerOverride ? (
            <button onClick={machine.override}>I played that right</button>
          ) : null}
          {/* Always available. The reveal phase otherwise only ends on a correct play,
              which assumes the learner is physically able to form the shape — meeting a
              first barre chord, they often aren't, and abandoning the session shouldn't be
              the only way out. */}
          <button onClick={onSetAside}>Can't play this yet</button>
        </div>
      </div>
      {!machine.offerOverride ? (
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          Keep your hands on the uke — it advances by itself.
        </p>
      ) : null}
    </div>
  );
}
