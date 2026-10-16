import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../firebaseConfig";

export const addTransaction = async (profileId, data) => {
  const txRef = doc(collection(db, "profiles", profileId, "transactions"));

  await setDoc(txRef, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return txRef.id;
};
