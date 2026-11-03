import { auth, db } from '@/src/firebaseConfig';
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  signOut as firebaseSignOut,
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

interface AuthContextType {
  user: FirebaseUser | null;
  loading: boolean;
  pinConfigured: boolean;
  biometricEnabled: boolean;
  isAppUnlocked: boolean;
  signUp: (email: string, password: string, name: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  updateAccountProfile: (name: string) => Promise<void>;
  hasPin: () => Promise<boolean>;
  setPin: (pin: string) => Promise<void>;
  verifyPin: (pin: string) => Promise<boolean>;
  getPinLockoutRemaining: () => Promise<number>;
  removePin: () => Promise<void>;
  recoverPinWithPassword: (password: string) => Promise<void>;
  setBiometricEnabled: (enabled: boolean) => Promise<void>;
  lockApp: () => void;
  unlockApp: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
let isSigningUp = false;

const PIN_ATTEMPTS_LIMIT = 5;
const PIN_LOCKOUT_MS = 60_000;
const pinKey = (uid: string) => `user_pin_${uid}`;
const biometricKey = (uid: string) => `user_biometric_enabled_${uid}`;
const attemptsKey = (uid: string) => `user_pin_attempts_${uid}`;
const lockoutKey = (uid: string) => `user_pin_lockout_until_${uid}`;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [pinConfigured, setPinConfigured] = useState(false);
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [isAppUnlocked, setIsAppUnlocked] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (isSigningUp) return;

      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const [storedPin, storedBiometric] = await Promise.all([
            SecureStore.getItemAsync(pinKey(firebaseUser.uid)),
            SecureStore.getItemAsync(biometricKey(firebaseUser.uid)),
          ]);
          const hasStoredPin = storedPin !== null;
          setPinConfigured(hasStoredPin);
          setBiometricEnabledState(hasStoredPin && storedBiometric === 'true');
          // Existing PINs always require verification after a fresh auth session.
          setIsAppUnlocked(!hasStoredPin);
        } catch (error) {
          console.error('Unable to load app-lock settings:', error);
          // Fail closed if a configured PIN cannot be read. The PIN screen will
          // still be available after the preference state is hydrated.
          setPinConfigured(true);
          setBiometricEnabledState(false);
          setIsAppUnlocked(false);
        }

        await SecureStore.setItemAsync('auth_uid', firebaseUser.uid);
        try {
          const token = await firebaseUser.getIdToken();
          await SecureStore.setItemAsync('auth_token', token);
        } catch (error) {
          console.error('Error getting ID token:', error);
        }
      } else {
        await SecureStore.deleteItemAsync('auth_uid');
        await SecureStore.deleteItemAsync('auth_token');
        setPinConfigured(false);
        setBiometricEnabledState(false);
        setIsAppUnlocked(false);
      }

      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const signUp = async (email: string, password: string, name: string) => {
    try {
      isSigningUp = true;
      const result = await createUserWithEmailAndPassword(auth, email, password);
      const uid = result.user.uid;
      await updateProfile(result.user, { displayName: name });
      await setDoc(doc(db, 'users', uid), {
        name,
        email,
        createdAt: new Date(),
      });
      await setDoc(doc(db, 'profiles', uid), {
        userId: uid,
        name,
        nameLower: name.trim().toLowerCase(),
        type: 'personal',
        emoji: '👤',
        currency: 'INR',
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await firebaseSignOut(auth);
      isSigningUp = false;
      return { error: null };
    } catch (error) {
      isSigningUp = false;
      return { error };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      return { error: null };
    } catch (error) {
      return { error };
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    await SecureStore.deleteItemAsync('auth_uid');
    await SecureStore.deleteItemAsync('auth_token');
  };

  const updateAccountProfile = async (name: string) => {
    const normalizedName = String(name || '').trim();
    if (!user) throw new Error('Sign in before updating your account.');
    if (!normalizedName) throw new Error('Enter your name.');
    if (normalizedName.length > 80) throw new Error('Name must be 80 characters or fewer.');

    await updateProfile(user, { displayName: normalizedName });
    await setDoc(doc(db, 'users', user.uid), {
      name: normalizedName,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  };

  const hasPin = async () => {
    if (!user) return false;
    return (await SecureStore.getItemAsync(pinKey(user.uid))) !== null;
  };

  const setPin = async (pin: string) => {
    if (!user) throw new Error('A signed-in user is required to set a PIN.');
    if (!/^\d{6}$/.test(pin)) throw new Error('Your app PIN must contain exactly 6 digits.');
    await SecureStore.setItemAsync(pinKey(user.uid), pin);
    await SecureStore.deleteItemAsync(attemptsKey(user.uid));
    await SecureStore.deleteItemAsync(lockoutKey(user.uid));
    setPinConfigured(true);
    setIsAppUnlocked(true);
  };

  const getPinLockoutRemaining = useCallback(async () => {
    if (!user) return 0;
    const rawUntil = await SecureStore.getItemAsync(lockoutKey(user.uid));
    const until = Number(rawUntil || 0);
    const remaining = Math.max(0, until - Date.now());
    if (remaining === 0 && rawUntil) {
      await SecureStore.deleteItemAsync(lockoutKey(user.uid));
      await SecureStore.deleteItemAsync(attemptsKey(user.uid));
    }
    return remaining;
  }, [user]);

  const verifyPin = async (pin: string) => {
    if (!user || !/^\d{6}$/.test(pin)) return false;
    const remaining = await getPinLockoutRemaining();
    if (remaining > 0) return false;

    const stored = await SecureStore.getItemAsync(pinKey(user.uid));
    if (stored !== null && stored === pin) {
      await SecureStore.deleteItemAsync(attemptsKey(user.uid));
      await SecureStore.deleteItemAsync(lockoutKey(user.uid));
      return true;
    }

    const attemptsRaw = await SecureStore.getItemAsync(attemptsKey(user.uid));
    const attempts = Number(attemptsRaw || 0) + 1;
    if (attempts >= PIN_ATTEMPTS_LIMIT) {
      await SecureStore.setItemAsync(lockoutKey(user.uid), String(Date.now() + PIN_LOCKOUT_MS));
      await SecureStore.deleteItemAsync(attemptsKey(user.uid));
    } else {
      await SecureStore.setItemAsync(attemptsKey(user.uid), String(attempts));
    }
    return false;
  };

  const removePin = async () => {
    if (!user) return;
    await Promise.all([
      SecureStore.deleteItemAsync(pinKey(user.uid)),
      SecureStore.deleteItemAsync(biometricKey(user.uid)),
      SecureStore.deleteItemAsync(attemptsKey(user.uid)),
      SecureStore.deleteItemAsync(lockoutKey(user.uid)),
    ]);
    setPinConfigured(false);
    setBiometricEnabledState(false);
    setIsAppUnlocked(true);
  };

  const recoverPinWithPassword = async (password: string) => {
    if (!user?.email) throw new Error('This account does not have an email/password sign-in method.');
    const supportsPassword = user.providerData.some((provider) => provider.providerId === 'password');
    if (!supportsPassword) throw new Error('PIN recovery with a password is not available for this sign-in method.');
    if (!password) throw new Error('Enter your account password.');

    const credential = EmailAuthProvider.credential(user.email, password);
    await reauthenticateWithCredential(user, credential);
    await removePin();
  };

  const setBiometricEnabled = async (enabled: boolean) => {
    if (!user) throw new Error('Sign in before changing biometric settings.');
    if (enabled && !pinConfigured) throw new Error('Set an app PIN before enabling biometric unlock.');
    await SecureStore.setItemAsync(biometricKey(user.uid), enabled ? 'true' : 'false');
    setBiometricEnabledState(enabled);
  };

  const lockApp = useCallback(() => {
    if (user && pinConfigured) setIsAppUnlocked(false);
  }, [user, pinConfigured]);

  const unlockApp = useCallback(() => {
    setIsAppUnlocked(true);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        pinConfigured,
        biometricEnabled,
        isAppUnlocked,
        signUp,
        signIn,
        signOut,
        updateAccountProfile,
        hasPin,
        setPin,
        verifyPin,
        getPinLockoutRemaining,
        removePin,
        recoverPinWithPassword,
        setBiometricEnabled,
        lockApp,
        unlockApp,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
