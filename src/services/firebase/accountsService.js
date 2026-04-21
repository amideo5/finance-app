import { db } from "../firebase";
import { doc, setDoc, serverTimestamp, collection } from "firebase/firestore";

export const addAccount = async (profileId, data) => {
  const accountRef = doc(collection(db, "profiles", profileId, "accounts"));

  await setDoc(accountRef, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return accountRef.id;
};
