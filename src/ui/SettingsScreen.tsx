import { useCallback, useRef, useState } from 'react';
import { supportsTuning } from '../music/shapes';
import { TUNINGS } from '../music/tunings';
import { noteName } from '../music/pitch';
import type { SessionSettings } from '../srs/types';
import type { Store } from '../store/db';

/**
 * Settings.
 *
 * The tuning selector is the one that matters most: high-G and low-G take identical fret
 * patterns but different pitches, so a low-G player scored against high-G expectations
 * gets told their 4th string is muted on every single chord. Without this control they
 * simply cannot use the app.
 */
export function SettingsScreen({
  settings,
  onChange,
  store,
  onBack,
  onReset,
}: {
  settings: SessionSettings;
  onChange: (s: SessionSettings) => void;
  store: Store | null;
  onBack: () => void;
  onReset: () => void;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportData = useCallback(async () => {
    if (!store) return;
    const json = await store.exportAll();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `uke-learner-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Exported.');
  }, [store]);

  const importData = useCallback(
    async (file: File) => {
      if (!store) return;
      try {
        const parsed = await store.importAll(await file.text());
        setStatus(`Imported ${parsed.cards} cards and ${parsed.reviews} reviews. Reload to see them.`);
      } catch (e) {
        setStatus(e instanceof Error ? `Import failed: ${e.message}` : 'Import failed.');
      }
    },
    [store],
  );

  return (
    <div className="app">
      <div className="row spread" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Settings</h1>
        <button onClick={onBack}>Done</button>
      </div>

      <div className="card">
        <h2>Your ukulele</h2>
        <p>
          High-G and low-G use the same finger shapes but sound different notes, so this has
          to match your instrument or every chord will look wrong.
        </p>
        <div className="stack" style={{ gap: 10 }}>
          {TUNINGS.map((t) => {
            const usable = supportsTuning(t.id);
            return (
              <label
                key={t.id}
                className="row"
                style={{
                  gap: 10,
                  // flex-start, not centre: the disabled option carries an explanatory
                  // paragraph, and centring floats its radio button off on its own line.
                  alignItems: 'flex-start',
                  opacity: usable ? 1 : 0.5,
                  cursor: usable ? 'pointer' : 'not-allowed',
                }}
              >
                <input
                  type="radio"
                  name="tuning"
                  checked={settings.tuningId === t.id}
                  disabled={!usable}
                  onChange={() => onChange({ ...settings, tuningId: t.id })}
                  style={{ marginTop: 4 }}
                />
                <span className="stack" style={{ gap: 2 }}>
                  <strong>{t.label}</strong>
                  <span className="muted mono">
                    {t.openNotes.map(noteName).join(' · ')}
                    {t.reentrant ? ' · reentrant' : ''}
                  </span>
                  {!usable ? (
                    <span className="muted">
                      Not yet — the same fret patterns make different chords on a baritone,
                      so it needs its own chord library rather than a setting.
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h2>Practice</h2>

        <label htmlFor="new" className="muted">
          New chords per day
        </label>
        <div className="row" style={{ marginTop: 6, marginBottom: 4 }}>
          <input
            id="new"
            type="range"
            min={1}
            max={12}
            value={settings.newCardsPerDay}
            onChange={(e) => onChange({ ...settings, newCardsPerDay: Number(e.target.value) })}
            style={{ flex: 1 }}
          />
          <strong style={{ minWidth: 40, textAlign: 'right' }}>{settings.newCardsPerDay}</strong>
        </div>
        <p className="muted">
          Chord shapes are physically demanding in a way vocabulary isn't. A high number here
          will make your hand ache before it makes you better.
        </p>

        <label htmlFor="tier" className="muted">
          How far to go
        </label>
        <div className="row" style={{ marginTop: 6, marginBottom: 18 }}>
          <select
            id="tier"
            value={settings.maxTier}
            onChange={(e) => onChange({ ...settings, maxTier: Number(e.target.value) })}
          >
            <option value={1}>The first four — C, Am, F, G7</option>
            <option value={2}>Open majors and minors</option>
            <option value={3}>Add sevenths</option>
            <option value={4}>Add barre chords</option>
            <option value={5}>Everything</option>
          </select>
        </div>

        <label htmlFor="ret" className="muted">
          How well you want to remember them
        </label>
        <div className="row" style={{ marginTop: 6, marginBottom: 4 }}>
          <input
            id="ret"
            type="range"
            min={80}
            max={97}
            value={Math.round(settings.requestRetention * 100)}
            onChange={(e) => onChange({ ...settings, requestRetention: Number(e.target.value) / 100 })}
            style={{ flex: 1 }}
          />
          <strong style={{ minWidth: 48, textAlign: 'right' }}>
            {Math.round(settings.requestRetention * 100)}%
          </strong>
        </div>
        <p className="muted" style={{ marginBottom: 18 }}>
          Higher means chords come back sooner and you review more. 90% is the usual balance.
        </p>

        <label className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <input
            type="checkbox"
            checked={settings.earTraining}
            onChange={(e) => onChange({ ...settings, earTraining: e.target.checked })}
            style={{ marginTop: 3 }}
          />
          <span className="stack" style={{ gap: 2 }}>
            <strong>Ear training</strong>
            <span className="muted">
              Adds cards that play a chord for you to find. Only for chords you can already
              play, since otherwise there's no way to answer.
            </span>
          </span>
        </label>
      </div>

      <div className="card">
        <h2>Listening</h2>
        <label htmlFor="sens" className="muted">
          Detector leniency
        </label>
        <div className="row" style={{ marginTop: 6, marginBottom: 4 }}>
          <input
            id="sens"
            type="range"
            min={80}
            max={130}
            value={Math.round(settings.sensitivity * 100)}
            onChange={(e) => onChange({ ...settings, sensitivity: Number(e.target.value) / 100 })}
            style={{ flex: 1 }}
          />
          <strong style={{ minWidth: 48, textAlign: 'right' }}>
            {settings.sensitivity < 0.95 ? 'strict' : settings.sensitivity > 1.05 ? 'lenient' : 'default'}
          </strong>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          Turn this up if a noisy room makes the app reject chords you played correctly. Be
          sparing: a lenient detector also accepts chords you played <em>wrong</em>, and
          being told a wrong shape is right is the one thing that actively sets you back.
        </p>
      </div>

      <div className="card">
        <h2>Your data</h2>
        <p>
          Everything lives on this device — no account, nothing uploaded. That also means
          clearing your browser data clears your progress, so export if you care about it.
        </p>
        <div className="row">
          <button onClick={() => void exportData()} disabled={!store}>
            Export
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={!store}>
            Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importData(f);
              e.target.value = '';
            }}
          />
        </div>
        {status ? (
          <div className="banner ok" style={{ marginTop: 12, marginBottom: 0 }}>
            {status}
          </div>
        ) : null}
      </div>

      <div className="card">
        <h2>Start over</h2>
        <p style={{ marginBottom: 12 }}>
          Deletes every card and review on this device. There is no undo — export first.
        </p>
        {/* Two steps, because there is genuinely no way back and the button sits one
            mis-tap away from the import control directly above it. */}
        {confirmReset ? (
          <div className="row">
            <button
              onClick={() => {
                setConfirmReset(false);
                onReset();
              }}
              style={{ background: 'var(--bad-soft)', color: 'var(--bad)', borderColor: 'var(--bad-soft)' }}
            >
              Yes, erase everything
            </button>
            <button onClick={() => setConfirmReset(false)}>Keep my progress</button>
          </div>
        ) : (
          <button onClick={() => setConfirmReset(true)}>Erase my progress</button>
        )}
      </div>
    </div>
  );
}
