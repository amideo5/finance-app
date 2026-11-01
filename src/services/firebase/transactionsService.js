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
      const accountData = accountSnapshot.data();
      const current = Number(accountData.balance ?? 0);
      if (!Number.isFinite(current)) throw new Error("The selected account has an invalid balance. Update the account before recording this transaction.");

      // Every ordinary expense must be covered by the selected account. This is
      // checked inside the same Firestore transaction as the debit, so a stale
      // screen balance or simultaneous spend cannot bypass the guard.
      if (delta < 0 && current + delta < -0.000001) {
        const accountName = typeof accountData.name === "string" && accountData.name.trim()
          ? accountData.name.trim()
          : "selected account";
        throw new Error(
          `Insufficient balance in ${accountName}. Available ₹${current.toFixed(2)}, required ₹${Math.abs(delta).toFixed(2)}. Choose another account or add funds first.`,
        );
      }
      transaction.update(accountRef, {
        balance: current + delta,
        balanceInPaise: Math.round((current + delta) * 100),
        updatedAt: serverTimestamp(),
      });
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