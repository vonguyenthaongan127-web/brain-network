import { useState } from "react";
import { db, storage } from "./firebase.js";
import UserSelect from "./UserSelect.jsx";
import BrainNetwork from "../brain_network_2.jsx";

export default function App() {
  const [currentUser, setCurrentUser] = useState(null); // { id, name, emoji, color }
  const [lang, setLang] = useState(() => localStorage.getItem("brain-lang") || "en");

  const handleSetLang = (l) => {
    localStorage.setItem("brain-lang", l);
    setLang(l);
  };

  if (!currentUser) {
    return <UserSelect db={db} onSelect={setCurrentUser} lang={lang} />;
  }

  return (
    <BrainNetwork
      db={db}
      storage={storage}
      userId={currentUser.id}
      user={currentUser}
      lang={lang}
      setLang={handleSetLang}
      onBack={() => setCurrentUser(null)}
    />
  );
}
