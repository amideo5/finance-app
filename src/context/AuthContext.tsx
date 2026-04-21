import { auth, db } from '@/src/firebaseConfig';
import {
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  updateProfile
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import React, { createContext, useContext, useEffect, useState } from 'react';

import * as SecureStore from 'expo-secure-store';

interface AuthContextType {
  user: FirebaseUser | null;
  loading: boolean;
  signUp: (email: string, password: string, name: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  hasPin: () => Promise<boolean>;
  setPin: (pin: string) => Promise<void>;
  verifyPin: (pin: string) => Promise<boolean>;
  removePin: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);

  // --------------------------------------------
  // Load stored UID from SecureStore (persistence)
  // --------------------------------------------
  useEffect(() => {
    // Set up listener for auth state changes
    // This will fire immediately with the current auth state
    // Firebase will automatically restore the session if it exists
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        // Save uid and token for backup
        await SecureStore.setItemAsync("auth_uid", firebaseUser.uid);
        try {
          const token = await firebaseUser.getIdToken();
          await SecureStore.setItemAsync("auth_token", token);
        } catch (error) {
          console.error("Error getting ID token:", error);
        }
      } else {
        // Clear stored credentials on logout
        await SecureStore.deleteItemAsync("auth_uid");
        await SecureStore.deleteItemAsync("auth_token");
      }

      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // --------------------------------------------
  // SIGN UP
  // --------------------------------------------
  const signUp = async (email: string, password: string, name: string) => {
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      const uid = result.user.uid;

      await updateProfile(result.user, { displayName: name });

      await setDoc(doc(db, "users", uid), {
        name,
        email,
        createdAt: new Date(),
      });

      await setDoc(doc(db, "profiles", uid), {
        userId: uid,
        name: name,
        type: "personal",
        emoji: "👤",
        currency: "INR",
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return { error: null };
    } catch (error) {
      return { error };
    }
  };

  // --------------------------------------------
  // SIGN IN
  // --------------------------------------------
  const signIn = async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      return { error: null };
    } catch (error) {
      return { error };
    }
  };

  // --------------------------------------------
  // SIGN OUT
  // --------------------------------------------
  const signOut = async () => {
    await firebaseSignOut(auth);
    await SecureStore.deleteItemAsync("auth_uid");
    await SecureStore.deleteItemAsync("auth_token");
  };

  // --------------------------------------------
  // PIN SYSTEM
  // --------------------------------------------
  const hasPin = async () => {
    const pin = await SecureStore.getItemAsync("user_pin");
    return pin !== null;
  };

  const setPin = async (pin: string) => {
    await SecureStore.setItemAsync("user_pin", pin);
  };

  const verifyPin = async (pin: string) => {
    const stored = await SecureStore.getItemAsync("user_pin");
    return stored === pin;
  };

  const removePin = async () => {
    await SecureStore.deleteItemAsync("user_pin");
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signUp,
        signIn,
        signOut,
        hasPin,
        setPin,
        verifyPin,
        removePin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
