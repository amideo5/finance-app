import { db } from "../firebase";
import {
  collection,
  doc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

export const createProfile = async (userId, name, type = "personal") => {
  const profileRef = doc(collection(db, "profiles"));

  await setDoc(profileRef, {
    userId,
    name,
    type,
    emoji: "💰",
    currency: "INR",
    isDefault: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Add owner to members
  const memberRef = doc(db, "profiles", profileRef.id, "members", userId);
  await setDoc(memberRef, {
    role: "owner",
    invitedBy: userId,
    createdAt: serverTimestamp(),
  });

  return profileRef.id;
};
