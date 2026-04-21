import { db } from "../firebase";
import { doc, collection, setDoc, serverTimestamp } from "firebase/firestore";

export const addInvestmentTx = async (profileId, investmentId, data) => {
  const txRef = doc(
    collection(
      db,
      "profiles",
      profileId,
      "investments",
      investmentId,
      "transactions"
    )
  );

  await setDoc(txRef, {
    ...data,
    createdAt: serverTimestamp(),
  });

  return txRef.id;
};
