import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../firebaseConfig";

export const addInvestment = async (profileId, data) => {
  const investRef = doc(collection(db, "profiles", profileId, "investments"));

  await setDoc(investRef, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return investRef.id;
};
