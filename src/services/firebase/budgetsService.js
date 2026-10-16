import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../firebaseConfig";

export const setBudget = async (profileId, categoryId, month, year, amount) => {
  const budgetId = `${categoryId}_${year}_${month}`;
  const ref = doc(db, "profiles", profileId, "budgets", budgetId);

  await setDoc(ref, {
    categoryId,
    month,
    year,
    limitAmount: amount,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return budgetId;
};
