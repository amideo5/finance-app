import { db } from "../firebase";
import { doc, setDoc, serverTimestamp, collection } from "firebase/firestore";

export const createGoal = async (profileId, data) => {
  const goalRef = doc(collection(db, "profiles", profileId, "goals"));

  await setDoc(goalRef, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return goalRef.id;
};
