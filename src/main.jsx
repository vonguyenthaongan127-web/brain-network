import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

// ── Global error telemetry ─────────────────────────────────────────────────
// Logs uncaught errors to the console with a [BrainNetwork Error] prefix so
// they are easy to find in DevTools, even when React's ErrorBoundary catches
// the render-phase version. These fire for non-render errors (e.g. event
// handlers, async callbacks) that don't reach the boundary.
window.onerror = (msg, src, line, col, error) => {
  console.error("[BrainNetwork Error]", msg, { src, line, col, error });
};
window.onunhandledrejection = (event) => {
  console.error("[BrainNetwork Error] Unhandled Promise rejection:", event.reason);
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
