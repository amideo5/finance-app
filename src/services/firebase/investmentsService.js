import { db } from "../firebase";
import { doc, setDoc, collection, serverTimestamp } from "firebase/firestore";

export const addInvestment = async (profileId, data) => {
  const investRef = doc(collection(db, "profiles", profileId, "investments"));

  await setDoc(investRef, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return investRef.id;
};
