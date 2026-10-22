import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "../../firebaseConfig";

/** Persist a transaction and its account balance effect atomically. Amounts on
 * ordinary app transactions are stored in rupees; split records can carry paise. */
export const addTransaction = async (profileId, data) => {
  const txRef = doc(collection(db, "profiles", profileId, "transactions"));
  const accountId = data.accountId || null;
  const accountRef = accountId ? doc(db, "profiles", profileId, "accounts", accountId) : null;
  const amount = Number.isSafeInteger(data.amountInPaise)
    ? data.amountInPaise / 100
    : Number(data.amount || 0);
  // Split allocation rows describe consumption but do not represent an additional
  // movement of cash. Repayment rows do move money and use their income/expense type.
  const affectsBalance = data.kind !== "allocation" && data.kind !== "source";
  const delta = !affectsBalance || !accountRef ? 0
    : data.type === "income" ? amount
    : data.type === "expense" ? -amount : 0;

  await runTransaction(db, async (transaction) => {
    if (accountRef && delta !== 0) {
      const accountSnapshot = await transaction.get(accountRef);
      if (!accountSnapshot.exists()) throw new Error("Selected account no longer exists.");
      const current = Number(accountSnapshot.data().balance || 0);
      transaction.update(accountRef, { balance: current + delta, updatedAt: serverTimestamp() });
    }
    transaction.set(txRef, {
      ...data,
      accountId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  return txRef.id;
};
