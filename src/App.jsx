import { useState, useEffect } from "react";
import { db, storage } from "./firebase.js";
import { ref as stRef, uploadBytes } from "firebase/storage";
import UserSelect from "./UserSelect.jsx";
import BrainNetwork from "../brain_network_2.jsx";

// ── Startup Storage probe ──────────────────────────────────────────────────
// Uploads a 4-byte blob to /_test/connection-check.txt on mount.
// Shows a floating badge: purple=testing, green=OK, red=exact error.message.
// Badge auto-hides 4 s after success so it doesn't clutter the main UI.

function StorageBadge({ status }) {
  if (!status) return null;
  const isOK      = status === "Storage connection OK";
  const isTesting = status.startsWith("Testing");
  const bg     = isOK ? "rgba(34,197,94,.15)"  : isTesting ? "rgba(168,85,247,.12)" : "rgba(239,68,68,.15)";
  const border = isOK ? "rgba(34,197,94,.4)"   : isTesting ? "rgba(168,85,247,.35)" : "rgba(239,68,68,.4)";
  const color  = isOK ? "#4ade80"              : isTesting ? "#c084fc"              : "#f87171";
  return (
    <div style={{
      position:"fixed", top:8, right:8, zIndex:9999,
      padding:"6px 12px", borderRadius:8, fontSize:11, fontFamily:"sans-serif",
      maxWidth:340, wordBreak:"break-word",
      background: bg, border:`1px solid ${border}`, color,
    }}>
      {status}
    </div>
  );
}

export default function App() {
  const [currentUser,   setCurrentUser]   = useState(null);
  const [lang,          setLang]          = useState(() => localStorage.getItem("brain-lang") || "en");
  const [storageStatus, setStorageStatus] = useState("Testing storage…");

  // Run once on mount — probe Firebase Storage
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const blob     = new Blob(["ping"], { type: "text/plain" });
        const testRef  = stRef(storage, "_test/connection-check.txt");
        await uploadBytes(testRef, blob);
        if (!cancelled) {
          setStorageStatus("Storage connection OK");
          // Auto-hide after 4 s on success
          setTimeout(() => { if (!cancelled) setStorageStatus(""); }, 4000);
        }
      } catch (err) {
        if (!cancelled) setStorageStatus(err.message || "Storage error");
      }
    };
    probe();
    return () => { cancelled = true; };
  }, []);

  const handleSetLang = (l) => {
    localStorage.setItem("brain-lang", l);
    setLang(l);
  };

  if (!currentUser) {
    return (
      <>
        <StorageBadge status={storageStatus} />
        <UserSelect db={db} onSelect={setCurrentUser} lang={lang} />
      </>
    );
  }

  return (
    <>
      <StorageBadge status={storageStatus} />
      <BrainNetwork
        db={db}
        storage={storage}
        userId={currentUser.id}
        user={currentUser}
        lang={lang}
        setLang={handleSetLang}
        onBack={() => setCurrentUser(null)}
      />
    </>
  );
}
