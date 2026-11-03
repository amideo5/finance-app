import { collection, deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../firebaseConfig";

const goalRef = (profileId, goalId) => doc(db, "profiles", profileId, "goals", goalId);

const validateGoal = (data) => {
  const name = String(data?.name || "").trim();
  const targetAmount = Number(data?.targetAmount);
  const currentAmount = Number(data?.currentAmount || 0);
  if (!name) throw new Error("Enter a goal name.");
  if (!Number.isFinite(targetAmount) || targetAmount <= 0) throw new Error("Goal target must be greater than zero.");
  if (!Number.isFinite(currentAmount) || currentAmount < 0) throw new Error("Current goal amount cannot be negative.");
  return { name, targetAmount, currentAmount };
};

export const createGoal = async (profileId, data) => {
  if (!profileId) throw new Error("A finance profile is required.");
  const normalized = validateGoal(data);
  const ref = doc(collection(db, "profiles", profileId, "goals"));
  await setDoc(ref, {
    ...data,
    ...normalized,
    icon: String(data.icon || "🎯"),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
};

export const updateGoal = async (profileId, goalId, updates) => {
  if (!profileId || !goalId) throw new Error("Choose a goal to update.");
  const normalized = validateGoal(updates);
  await updateDoc(goalRef(profileId, goalId), {
    ...updates,
    ...normalized,
    icon: String(updates.icon || "🎯"),
    updatedAt: serverTimestamp(),
  });
  return true;
};

export const deleteGoal = async (profileId, goalId) => {
  if (!profileId || !goalId) throw new Error("Choose a goal to delete.");
  await deleteDoc(goalRef(profileId, goalId));
  return true;
};
