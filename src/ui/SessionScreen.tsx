import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AudioEngine } from '../audio/engine';
import { describeDiagnosis } from '../audio/verdict';
import { getShape, resolveShape } from '../music/shapes';
import type { Session } from '../srs/session';
import { shapeName } from '../srs/scheduler';
import type { StringDiagnosis, Verdict } from '../types';
import { ChordDiagram } from './ChordDiagram';
import { LevelBars } from './LevelMeter';
import { announce, useSessionMachine } from './useSessionMachine';

/** How long a correct answer stays on screen before the next card. */
const CORRECT_HOLD_MS = 700;

/** Dots on the correct screen: session progress, in quarters. */
const PROGRESS_DOTS = 4;

/**
 * The two words a wrong answer gets.
 *
 * The arrow points where the finger has to go *on the board as drawn* — nut at the top —
 * because that is what the learner is looking at. Everything else about the mistake is
 * already marked on the diagram: the string in red, a cross where the note landed, a pulse
 * on where it should have been.
 */
const nudgeFor = (
  diagnosis: readonly StringDiagnosis[],
): { arrow: string | null; text: string } | null => {
  const fault = diagnosis.find((d) => d.fault.kind !== 'ok')?.fault;
  if (!fault) return null;
  if (fault.kind === 'wrong_fret') {
    const n = Math.abs(fault.fretDelta);
    return {
      arrow: fault.fretDelta > 0 ? '↑' : '↓',
      text: `${n === 1 ? 'one fret' : n === 2 ? 'two frets' : `${n} frets`}`,
    };
  }
  if (fault.kind === 'missing') return { arrow: null, text: 'not sounding' };
  return { arrow: null, text: 'once more' };
};

/**
 * The practice loop.
 *
 * The board is the screen. Everything else is a bar, a pulse or a number, because this is
 * operated with both hands on the instrument — the moment a learner has to put the ukulele
 * down to press something, the product's whole premise is gone.
 */
export function SessionScreen({
  session,
  engine,
  tuningId,
  onFinish,
}: {
  session: Session;
  engine: AudioEngine;
  tuningId: string;
  onFinish: () => void;
}) {
  const machine = useSessionMachine();
  const [snapshot, setSnapshot] = useState(() => session.snapshot());
  const [lastVerdict, setLastVerdict] = useState<Verdict | null>(null);
  const [playingChord, setPlayingChord] = useState(false);

  const card = snapshot.current;
  const shape = useMemo(() => (card ? getShape(card.shapeId) : null), [card]);
  const toShape = useMemo(() => (card?.toShapeId ? getShape(card.toShapeId) : null), [card]);
  const isTransition = card?.presentation === 'transition' && toShape !== null;
  const isEarTraining = card?.presentation === 'ear_to_play';

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

  /** Play the chord for an ear-training card. Detection is paused while it sounds. */
  const hearIt = useCallback(async () => {
    if (!card || playingChord) return;
    setPlayingChord(true);
    const notes = resolveShape(getShape(card.shapeId), tuningId).perString;
    await engine.playChord(notes);
    engine.setTarget(activeShapeId);
    setPlayingChord(false);
  }, [card, engine, activeShapeId, playingChord, tuningId]);

  // Ear-training cards play themselves on arrival — the learner shouldn't have to reach
  // for the screen to start a card whose whole point is not touching the screen.
  useEffect(() => {
    if (isEarTraining) void hearIt();
    // Only on card change, never on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.presentationKey, isEarTraining]);

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

  // Once graded, hold the right answer on screen for a beat, then move on. The pause is
  // the reward — a card that vanishes the instant it lands never registers as a win.
  useEffect(() => {
    if (machine.state.phase !== 'graded' || !machine.state.outcome) return;
    const outcome = machine.state.outcome;
    const id = setTimeout(() => {
      session.answer(outcome);
      const next = session.snapshot();
      setSnapshot(next);
      if (session.isFinished()) onFinish();
    }, CORRECT_HOLD_MS);
    return () => clearTimeout(id);
  }, [machine.state.phase, machine.state.outcome, session, onFinish]);

  // Tick the clock so a session that runs out of time ends on its own.
  useEffect(() => {
    const id = setInterval(() => {
      setSnapshot(session.snapshot());
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
  const correct = phase === 'graded';
  const label = shapeName(card);
  const activeShape = isTransition && leg === 'second' && toShape ? toShape : shape;
  const progress =
    snapshot.reviewed + snapshot.remaining > 0
      ? (snapshot.reviewed / (snapshot.reviewed + snapshot.remaining)) * 100
      : 0;

  const showDiagram = reveal || card.presentation === 'diagram_to_play';
  const wrong = lastVerdict?.kind === 'incorrect' && (phase === 'retry' || reveal);
  // Only mark the board when the board is already on screen. On a name-only card the shape
  // is the answer, and drawing it at the first wrong strum would hand over what the next
  // attempt is meant to recall — that is what the reveal step is for.
  const faults = wrong && lastVerdict?.kind === 'incorrect' ? lastVerdict.perString : null;
  const diagnosis = faults && showDiagram ? faults : undefined;
  const nudge = faults ? nudgeFor(faults) : null;

  const header = (
    <div className="row" style={{ gap: 16, flexWrap: 'nowrap', marginBottom: 4 }}>
      <button className="icon" onClick={onFinish} aria-label="End session">
        ✕
      </button>
      <div className={`meter grow${correct ? ' ok' : ''}`}>
        <i style={{ width: `${progress}%` }} />
      </div>
    </div>
  );

  const liveRegion = (
    <p aria-live="polite" className="sr-only">
      {announce(machine.state, label)}
      {faults
        ? ` ${faults
            .map(describeDiagnosis)
            .filter((s): s is string => s !== null)
            .slice(0, 2)
            .join(' ')}`
        : ''}
    </p>
  );

  if (correct) {
    const filled = Math.round((progress / 100) * PROGRESS_DOTS);
    return (
      <div className="app correct-flash">
        {header}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            paddingBottom: 60,
          }}
        >
          <div className="correct-mark" style={{ width: 220, height: 220 }}>
            <span className="disc" />
            <span className="pulse" />
            <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="correct">
              <path
                d="M26 50 L42 66 L72 32"
                fill="none"
                stroke="var(--ok)"
                strokeWidth="9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div
            style={{
              marginTop: 34,
              fontSize: 68,
              fontWeight: 500,
              letterSpacing: '-0.03em',
              color: 'var(--ok-deep)',
            }}
          >
            {label}
          </div>
          <div className="dots" style={{ marginTop: 44 }} aria-hidden="true">
            {Array.from({ length: PROGRESS_DOTS }, (_, i) => (
              <span key={i} className={i < filled ? 'on' : ''} />
            ))}
          </div>
        </div>
        {liveRegion}
      </div>
    );
  }

  return (
    <div className="app">
      {header}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {isEarTraining && !reveal ? (
          <div
            style={{ marginTop: 22, fontSize: 76, fontWeight: 500, letterSpacing: '-0.03em' }}
            aria-hidden="true"
          >
            ♪
          </div>
        ) : (
          <div style={{ marginTop: 22, fontSize: 76, fontWeight: 500, letterSpacing: '-0.03em' }}>
            {isTransition && toShape ? (
              <span style={{ fontSize: 54 }}>
                <span style={{ opacity: leg === 'first' ? 1 : 0.35 }}>{shape.name}</span>
                <span style={{ color: 'var(--ink-faint)' }} aria-hidden="true">
                  {' → '}
                </span>
                <span style={{ opacity: leg === 'second' ? 1 : 0.35 }}>{toShape.name}</span>
              </span>
            ) : (
              label
            )}
          </div>
        )}

        {isTransition && toShape && showDiagram ? (
          <div className="row" style={{ gap: 4, flexWrap: 'nowrap', marginTop: 12 }}>
            <div style={{ opacity: leg === 'first' ? 1 : 0.35 }}>
              <ChordDiagram shape={shape} width={150} tuningId={tuningId} />
            </div>
            <div style={{ opacity: leg === 'second' ? 1 : 0.35 }}>
              <ChordDiagram shape={toShape} width={150} tuningId={tuningId} />
            </div>
          </div>
        ) : showDiagram ? (
          <div className={wrong ? 'shake' : ''} key={`${snapshot.presentationKey}-${phase}`}>
            <ChordDiagram
              shape={activeShape}
              width={300}
              tuningId={tuningId}
              stringLabels
              {...(diagnosis ? { diagnosis } : {})}
            />
          </div>
        ) : null}

        {isEarTraining && !reveal ? (
          <button style={{ marginTop: 20 }} onClick={() => void hearIt()} disabled={playingChord}>
            {playingChord ? 'Listening…' : 'Play it again'}
          </button>
        ) : null}

        {nudge ? (
          <div className="nudge" style={{ marginTop: 14 }}>
            {nudge.arrow ? (
              <span className="arrow" aria-hidden="true">
                {nudge.arrow}
              </span>
            ) : null}
            {nudge.text}
          </div>
        ) : null}

        {message ? (
          <div className="banner warn" style={{ marginTop: 14 }}>
            {message}
          </div>
        ) : null}

        {isTransition && machine.state.transitionMs !== null ? (
          <div className="pill ok" style={{ marginTop: 14 }}>
            {(machine.state.transitionMs / 1000).toFixed(1)}s
          </div>
        ) : null}

        {/* Listening, and visibly so. The bars move with the room, so "it isn't hearing
            me" and "it heard me and I was wrong" never look the same. */}
        {!wrong && !message ? (
          <div
            className="push-down"
            style={{
              paddingBottom: 34,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 18,
            }}
          >
            <LevelBars engine={engine} count={5} height={44} className="small" />
            <span className="muted">listening</span>
          </div>
        ) : null}
      </div>

      {liveRegion}

      {/* The learner is the authority on what they played: a chord the detector keeps
          getting wrong is a bug on our side, and the override is logged as one. */}
      {wrong || machine.offerOverride ? (
        <button onClick={machine.override} style={{ width: '100%' }}>
          That was right
        </button>
      ) : null}

      {/* Reveal assumes the shape can be formed at all. Meeting a first barre chord it
          often can't be, and abandoning the session must not be the only way out. */}
      {reveal ? (
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button className="link" onClick={onSetAside}>
            Can't play this yet
          </button>
        </div>
      ) : null}
    </div>
  );
}
