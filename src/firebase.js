import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// ── Bucket name ───────────────────────────────────────────────────────────────
// Firebase projects created after ~Sep 2024 use firebasestorage.app, NOT appspot.com.
// We also pass the bucket URL explicitly to getStorage() so the SDK never guesses.
const STORAGE_BUCKET = "brainnetwork.firebasestorage.app";

const app = initializeApp({
  apiKey:            "AIzaSyBHsTgMJGgYVCYW6m_COxvcRkqMAMh8xaY",
  authDomain:        "brainnetwork.firebaseapp.com",
  projectId:         "brainnetwork",
  storageBucket:     STORAGE_BUCKET,
  messagingSenderId: "904941123446",
  appId:             "1:904941123446:web:43393e0f78fb3304f7ac57",
  measurementId:     "G-23F7SV4261",
});

export const db      = getFirestore(app);
// Explicit bucket URL prevents SDK from falling back to appspot.com default
export const storage = getStorage(app, `gs://${STORAGE_BUCKET}`);
