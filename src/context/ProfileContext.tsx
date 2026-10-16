import { db } from "@/src/firebaseConfig";
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDocs,
    query,
    updateDoc,
    where,
} from "firebase/firestore";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "./AuthContext";

interface Profile {
  id: string;
  userId: string;
  name: string;
  nameLower?: string;
  type: string;
  emoji: string;
  currency: string;
  isDefault: boolean;
  createdAt: any;
  updatedAt: any;
}

interface ProfileContextType {
  profiles: Profile[];
  currentProfile: Profile | null;
  loading: boolean;
  switchProfile: (profileId: string) => void;
  createProfile: (profile: Partial<Profile>) => Promise<void>;
  updateProfile: (profileId: string, updates: Partial<Profile>) => Promise<void>;
  deleteProfile: (profileId: string) => Promise<void>;
  refreshProfiles: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // Load profiles from Firestore
  const loadProfiles = useCallback(async () => {
    if (!user) {
      setProfiles([]);
      setCurrentProfile(null);
      setLoading(false);
      return;
    }

    try {
      const q = query(
        collection(db, "profiles"),
        where("userId", "==", user.uid)
      );

      const snapshot = await getDocs(q);
      const list: Profile[] = [];

      await Promise.all(snapshot.docs
        .filter((docSnap) => !docSnap.data().nameLower && docSnap.data().name)
        .map((docSnap) => updateDoc(doc(db, "profiles", docSnap.id), {
          nameLower: docSnap.data().name.trim().toLowerCase(),
        })));

      snapshot.forEach((docSnap) =>
        list.push({ id: docSnap.id, ...docSnap.data() } as Profile)
      );

      setProfiles(list);

      // Select default profile or fallback to first
      const defaultP = list.find((p) => p.isDefault) || list[0] || null;
      setCurrentProfile(defaultP);
    } catch (err) {
      console.error("Error loading profiles:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    // The provider must clear stale profile state when Firebase signs out.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProfiles();
  }, [loadProfiles]);

  const switchProfile = (profileId: string) => {
    const p = profiles.find((p) => p.id === profileId) || null;
    setCurrentProfile(p);
  };

  const createProfile = async (profile: Partial<Profile>) => {
    if (!user) return;

    const newProfile = {
      userId: user.uid,
      name: profile.name || "New Profile",
      nameLower: (profile.name || "New Profile").trim().toLowerCase(),
      type: profile.type || "personal",
      emoji: profile.emoji || "👤",
      currency: profile.currency || "INR",
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const docRef = await addDoc(collection(db, "profiles"), newProfile);

    await loadProfiles();
    setCurrentProfile({ id: docRef.id, ...newProfile });
  };

  const updateProfile = async (profileId: string, updates: Partial<Profile>) => {
    const ref = doc(db, "profiles", profileId);
    const normalizedUpdates = updates.name === undefined
      ? updates
      : { ...updates, nameLower: updates.name.trim().toLowerCase() };
    await updateDoc(ref, { ...normalizedUpdates, updatedAt: new Date() });
    await loadProfiles();
  };

  const deleteProfile = async (profileId: string) => {
    const ref = doc(db, "profiles", profileId);
    await deleteDoc(ref);
    await loadProfiles();
  };

  const refreshProfiles = async () => {
    await loadProfiles();
  };

  return (
    <ProfileContext.Provider
      value={{
        profiles,
        currentProfile,
        loading,
        switchProfile,
        createProfile,
        updateProfile,
        deleteProfile,
        refreshProfiles,
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx)
    throw new Error("useProfile must be used within a ProfileProvider");
  return ctx;
}
