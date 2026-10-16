import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../firebaseConfig";

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
