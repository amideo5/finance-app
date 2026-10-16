import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../firebaseConfig";

export const createGoal = async (profileId, data) => {
  const goalRef = doc(collection(db, "profiles", profileId, "goals"));

  await setDoc(goalRef, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return goalRef.id;
};
