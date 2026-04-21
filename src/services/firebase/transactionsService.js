import { db } from "../firebase";
import { doc, setDoc, serverTimestamp, collection } from "firebase/firestore";

export const addTransaction = async (profileId, data) => {
  const txRef = doc(collection(db, "profiles", profileId, "transactions"));

  await setDoc(txRef, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return txRef.id;
};
