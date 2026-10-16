import {
    collection,
    doc,
    endAt,
    getDocs,
    limit,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    startAt,
} from "firebase/firestore";
import { db } from "../../firebaseConfig";

export const createProfile = async (userId, name, type = "personal") => {
  const profileRef = doc(collection(db, "profiles"));

  await setDoc(profileRef, {
    userId,
    name,
    nameLower: name.trim().toLowerCase(),
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

export const searchProfilesByName = async (searchText) => {
  const prefix = searchText.trim().toLowerCase();
  if (prefix.length < 2) return [];

  const snapshot = await getDocs(query(
    collection(db, "profiles"),
    orderBy("nameLower"),
    startAt(prefix),
    endAt(`${prefix}\uf8ff`),
    limit(20)
  ));
  return snapshot.docs.map((profileDoc) => ({
    id: profileDoc.id,
    ...profileDoc.data(),
  }));
};
