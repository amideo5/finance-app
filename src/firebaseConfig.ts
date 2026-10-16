// Firebase v9+ Modular SDK for Expo
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";

// -----------------------------------------
// REPLACE THESE WITH YOUR FIREBASE CREDENTIALS
// (from: Firebase Console → Project Settings → SDK setup)
// -----------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyCeAf0pxyeO0gLlgkzL7IfU-3rRj0s9Fhw",
  authDomain: "f-app-041225.firebaseapp.com",
  projectId: "f-app-041225",
  storageBucket: "f-app-041225.firebasestorage.app",
  messagingSenderId: "396142071346",
  appId: "1:396142071346:web:3b48077e85bea73b9e362b",
  measurementId: "G-PP1QPTG1GW"
};

// Initialize Firebase app
const app = initializeApp(firebaseConfig);

// Initialize Auth
export const auth = getAuth(app);

// Initialize Firestore
export const db = getFirestore(app);
export const functions = getFunctions(app);

if (process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATORS === "true") {
  const emulatorHost = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST || "127.0.0.1";
  connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, emulatorHost, 8080);
  connectFunctionsEmulator(functions, emulatorHost, 5001);
}
