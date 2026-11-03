import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../firebaseConfig";

const budgetRef = (profileId, budgetId) => doc(db, "profiles", profileId, "budgets", budgetId);

export const setBudget = async (profileId, categoryId, month, year, amount) => {
  const numericMonth = Number(month);
  const numericYear = Number(year);
  const limitAmount = Number(amount);
  if (!profileId || !String(categoryId || "").trim()) throw new Error("Choose a category for this budget.");
  if (!Number.isInteger(numericMonth) || numericMonth < 1 || numericMonth > 12) throw new Error("Choose a valid budget month.");
  if (!Number.isInteger(numericYear) || numericYear < 2000 || numericYear > 9999) throw new Error("Choose a valid budget year.");
  if (!Number.isFinite(limitAmount) || limitAmount <= 0) throw new Error("Budget amount must be greater than zero.");

  const budgetId = `${categoryId}_${numericYear}_${numericMonth}`;
  await setDoc(budgetRef(profileId, budgetId), {
    categoryId: String(categoryId).trim(),
    month: numericMonth,
    year: numericYear,
    limitAmount,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return budgetId;
};

export const updateBudget = async (profileId, budgetId, updates) => {
  const limitAmount = Number(updates?.limitAmount ?? updates?.amount);
  if (!Number.isFinite(limitAmount) || limitAmount <= 0) throw new Error("Budget amount must be greater than zero.");
  await updateDoc(budgetRef(profileId, budgetId), {
    limitAmount,
    updatedAt: serverTimestamp(),
  });
  return true;
};

export const deleteBudget = async (profileId, budgetId) => {
  if (!profileId || !budgetId) throw new Error("Choose a budget to delete.");
  await deleteDoc(budgetRef(profileId, budgetId));
  return true;
};
