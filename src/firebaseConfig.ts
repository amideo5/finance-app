// Firebase v9+ Modular SDK for Expo
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

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
