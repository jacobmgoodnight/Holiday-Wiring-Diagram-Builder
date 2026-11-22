import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support in production builds only (a dev service worker would serve stale code).
// Some hosts (sandboxed frames) refuse service workers or even throw on access: offline
// support is then simply off.
let swOk = false;
try {
  swOk = import.meta.env.PROD && 'serviceWorker' in navigator && !!navigator.serviceWorker;
} catch {
  swOk = false;
}
if (swOk) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        const urls = performance.getEntriesByType('resource').map((r) => r.name);
        reg.active?.postMessage({ cache: [location.href, ...urls] });
      })
      .catch(() => undefined);
  });
}
