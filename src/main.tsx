import { registerSW } from 'virtual:pwa-register';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');
// Offline-first. A failure here must never block the app — a practice session works fine
// without a service worker, it just won't survive going offline.
try {
  registerSW({ immediate: true });
} catch {
  /* unsupported browser, or blocked by settings */
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
