import { Component } from "react";

// ── Outer ErrorBoundary — wraps the ENTIRE app ──────────────────────────────
// Catches any render error that reaches the top level and shows a recovery UI
// instead of a blank screen.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, showDetails: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("[BrainNetwork Error]", error.message, "\n", info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const { error, showDetails } = this.state;
    return (
      <div style={{
        height: "100vh", width: "100%",
        background: "radial-gradient(ellipse at 25% 40%, #1a0f3c 0%, #0d0820 55%, #050310 100%)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        fontFamily: "'Segoe UI',system-ui,sans-serif", color: "#e8dcff",
        padding: 24, boxSizing: "border-box",
      }}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>🧠</div>

        <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", marginBottom: 8 }}>
          Something went wrong.
        </div>

        <div style={{
          fontSize: 14, color: "rgba(232,220,255,.55)",
          marginBottom: 28, textAlign: "center", lineHeight: 1.6,
        }}>
          Your data is safe in Firebase.
        </div>

        <button
          onClick={() => window.location.reload()}
          style={{
            padding: "11px 32px", borderRadius: 10, cursor: "pointer",
            border: "1px solid rgba(168,85,247,.6)", background: "rgba(168,85,247,.22)",
            color: "#c084fc", fontSize: 15, fontWeight: 700, fontFamily: "inherit",
            marginBottom: 12, transition: "background .15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(168,85,247,.35)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(168,85,247,.22)"; }}
        >
          Reload App
        </button>

        <button
          onClick={() => this.setState(s => ({ showDetails: !s.showDetails }))}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "rgba(232,220,255,.35)", fontSize: 12, fontFamily: "inherit",
            textDecoration: "underline",
          }}
        >
          {showDetails ? "Hide" : "Show"} error details
        </button>

        {showDetails && (
          <pre style={{
            marginTop: 14, padding: "12px 16px", borderRadius: 8,
            maxWidth: 560, width: "100%",
            background: "rgba(0,0,0,.45)", border: "1px solid rgba(239,68,68,.25)",
            color: "#f87171", fontSize: 11, lineHeight: 1.55,
            overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
            textAlign: "left",
          }}>
            {error?.message}{"\n\n"}{error?.stack}
          </pre>
        )}
      </div>
    );
  }
}

// ── Inner CanvasErrorBoundary — wraps just the SVG canvas section ───────────
// A lighter fallback: keeps the header, toolbar, and topic bar alive while
// offering a targeted "Reset canvas view" recovery that re-mounts the canvas.
export class CanvasErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("[BrainNetwork Canvas Error]", error.message, "\n", info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,.2)", position: "relative",
      }}>
        <div style={{
          padding: "22px 32px", borderRadius: 14, textAlign: "center",
          background: "rgba(8,4,22,.93)", backdropFilter: "blur(20px)",
          border: "1px solid rgba(239,68,68,.3)",
          boxShadow: "0 0 40px rgba(239,68,68,.08)",
        }}>
          <div style={{ fontSize: 24, marginBottom: 10 }}>⚠️</div>
          <div style={{ fontSize: 13, color: "#f87171", marginBottom: 14, fontFamily: "inherit" }}>
            Canvas error.
          </div>
          <button
            onClick={() => {
              if (this.props.onReset) this.props.onReset();
              this.setState({ hasError: false });
            }}
            style={{
              padding: "8px 20px", borderRadius: 8, cursor: "pointer",
              border: "1px solid rgba(168,85,247,.5)", background: "rgba(168,85,247,.18)",
              color: "#c084fc", fontSize: 12, fontFamily: "inherit", fontWeight: 600,
            }}
          >
            Reset canvas view
          </button>
        </div>
      </div>
    );
  }
}
