/**
 * Shown once, on first run.
 *
 * The app's central premise — that you never touch the screen — is invisible until it
 * happens to you. Without this, a first-timer's instinct is to look for a "next" button,
 * not find one, and conclude the app is broken. Three sentences prevent that.
 */
export function WelcomeScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="app">
      <h1>Hands stay on the ukulele</h1>
      <p>
        This is chord practice that listens. You'll need your ukulele and somewhere
        reasonably quiet.
      </p>

      <div className="card">
        <ol style={{ paddingLeft: 20, margin: 0, color: 'var(--ink-soft)', lineHeight: 1.7 }}>
          <li>
            <strong style={{ color: 'var(--ink)' }}>A chord appears.</strong> Play it.
          </li>
          <li>
            <strong style={{ color: 'var(--ink)' }}>Get it right and it moves on</strong> by
            itself — there's nothing to tap.
          </li>
          <li>
            <strong style={{ color: 'var(--ink)' }}>Get it wrong and you get another go</strong>,
            with a hint about which finger is off. Miss twice and it shows you the shape.
          </li>
        </ol>
      </div>

      <div className="card">
        <h2>Two honest things</h2>
        <p>
          It hears <em>notes</em>, not hands. Two ways of fingering the same chord sound
          identical, so follow the diagrams as well — the app can't tell you your thumb is in
          a bad place.
        </p>
        <p style={{ marginBottom: 0 }}>
          Nothing leaves your device. No account, no upload, and it works offline. That also
          means clearing your browser data clears your progress.
        </p>
      </div>

      <button className="primary" onClick={onContinue} style={{ width: '100%' }}>
        Got it
      </button>
      <p className="muted" style={{ marginTop: 12, textAlign: 'center' }}>
        Next you'll be asked for microphone access — it's the only way cards can advance on
        their own.
      </p>
    </div>
  );
}
