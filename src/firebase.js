import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const app = initializeApp({
  apiKey:            "AIzaSyBHsTgMJGgYVCYW6m_COxvcRkqMAMh8xaY",
  authDomain:        "brainnetwork.firebaseapp.com",
  projectId:         "brainnetwork",
  storageBucket:     "brainnetwork.appspot.com",
  messagingSenderId: "904941123446",
  appId:             "1:904941123446:web:43393e0f78fb3304f7ac57",
  measurementId:     "G-23F7SV4261",
});

export const db      = getFirestore(app);
export const storage = getStorage(app);
