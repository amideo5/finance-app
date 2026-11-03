import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../firebaseConfig";

const toPaise = (value) => Math.round(Number(value || 0) * 100);

const getAmountInPaise = (data) => Number.isSafeInteger(data?.amountInPaise)
  ? data.amountInPaise
  : toPaise(data?.amount);

const getBalanceDelta = (data) => {
  // Split source/allocation rows are informational ledger entries; they do not
  // cause a second movement of cash. All other ordinary rows affect balances.
  if (!data?.accountId || data?.kind === "allocation" || data?.kind === "source") return 0;
  const amount = getAmountInPaise(data);
  if (data.type === "income") return amount;
  if (data.type === "expense") return -amount;
  return 0;
};

const assertEditableTransaction = (data) => {
  if (
    data?.kind || data?.splitId || data?.settlementId || data?.friendSettlementId ||
    data?.investmentTransferId || data?.investmentTransferDirection ||
    data?.investmentLedgerEntryId || data?.investmentId || data?.serverGenerated
  ) {
    throw new Error("This transaction is linked to a split, settlement, transfer, or generated ledger. It must be changed from its source workflow to keep all related records consistent.");
  }
};

const assertValidTransactionInput = (data) => {
  const amountInPaise = getAmountInPaise(data);
  if (!Number.isSafeInteger(amountInPaise) || amountInPaise <= 0) {
    throw new Error("Transaction amount must be a positive valid amount.");
  }
  if (!['income', 'expense'].includes(data?.type)) {
    throw new Error("Choose income or expense for this transaction.");
  }
  if (!data?.accountId) throw new Error("Choose an account for this transaction.");
  if (!String(data?.category || '').trim()) throw new Error("Choose a transaction category.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data?.date || ''))) {
    throw new Error("Enter a valid transaction date in YYYY-MM-DD format.");
  }
};

const readAccountBalanceInPaise = (account) => Number.isSafeInteger(account?.balanceInPaise)
  ? account.balanceInPaise
  : toPaise(account?.balance);

/** Persist a transaction and its account balance effect atomically. Amounts on
 * ordinary app transactions are stored in rupees; split rows can carry paise. */
export const addTransaction = async (profileId, data) => {
  assertValidTransactionInput(data);
  const txRef = doc(collection(db, "profiles", profileId, "transactions"));
  const accountRef = doc(db, "profiles", profileId, "accounts", data.accountId);
  const delta = getBalanceDelta({ ...data, amountInPaise: getAmountInPaise(data) });

  await runTransaction(db, async (transaction) => {
    if (delta !== 0) {
      const accountSnapshot = await transaction.get(accountRef);
      if (!accountSnapshot.exists()) throw new Error("Selected account no longer exists.");
      const accountData = accountSnapshot.data();
      const currentInPaise = readAccountBalanceInPaise(accountData);
      if (!Number.isSafeInteger(currentInPaise)) throw new Error("The selected account has an invalid balance. Update the account before recording this transaction.");
      if (currentInPaise + delta < 0) {
        throw new Error(`Insufficient balance in ${accountData.name || "selected account"}. Available ₹${(currentInPaise / 100).toFixed(2)}, required ₹${(Math.abs(delta) / 100).toFixed(2)}. Choose another account or add funds first.`);
      }
      const nextInPaise = currentInPaise + delta;
      transaction.update(accountRef, {
        balance: nextInPaise / 100,
        balanceInPaise: nextInPaise,
        updatedAt: serverTimestamp(),
      });
    }
    transaction.set(txRef, {
      ...data,
      accountId: data.accountId || null,
      amount: getAmountInPaise(data) / 100,
      amountInPaise: getAmountInPaise(data),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  return txRef.id;
};

/**
 * Update an ordinary transaction and atomically reconcile the old and new
 * account effects. Split/settlement/investment-transfer rows are intentionally
 * rejected; their paired source workflows own those records.
 */
export const updateTransaction = async (profileId, transactionId, data) => {
  if (!profileId || !transactionId) throw new Error("A transaction is required to update this record.");
  assertValidTransactionInput(data);
  const txRef = doc(db, "profiles", profileId, "transactions", transactionId);
  const nextData = {
    type: data.type,
    amount: getAmountInPaise(data) / 100,
    amountInPaise: getAmountInPaise(data),
    categoryId: data.categoryId || null,
    category: String(data.category || '').trim(),
    categoryIcon: data.categoryIcon || null,
    paymentMode: data.paymentMode || 'other',
    accountId: data.accountId,
    notes: data.notes || null,
    date: data.date,
    currency: data.currency || 'INR',
  };

  await runTransaction(db, async (transaction) => {
    const txSnapshot = await transaction.get(txRef);
    if (!txSnapshot.exists()) throw new Error("This transaction no longer exists.");
    const previous = txSnapshot.data();
    assertEditableTransaction(previous);
    assertEditableTransaction(data);

    const oldAccountId = previous.accountId || null;
    const newAccountId = nextData.accountId || null;
    const oldDelta = getBalanceDelta({ ...previous, amountInPaise: getAmountInPaise(previous) });
    const newDelta = getBalanceDelta({ ...nextData, amountInPaise: getAmountInPaise(nextData) });
    const affectedIds = [...new Set([oldAccountId, newAccountId].filter(Boolean))];
    const accountSnapshots = new Map();

    // Complete every transaction read before issuing any write.
    for (const accountId of affectedIds) {
      const ref = doc(db, "profiles", profileId, "accounts", accountId);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) throw new Error("A linked account no longer exists. Reassign the transaction to a valid account before editing it.");
      accountSnapshots.set(accountId, { ref, data: snapshot.data() });
    }

    const deltas = new Map();
    if (oldAccountId) deltas.set(oldAccountId, (deltas.get(oldAccountId) || 0) - oldDelta);
    if (newAccountId) deltas.set(newAccountId, (deltas.get(newAccountId) || 0) + newDelta);

    for (const [accountId, delta] of deltas) {
      if (!delta) continue;
      const account = accountSnapshots.get(accountId);
      const currentInPaise = readAccountBalanceInPaise(account.data);
      if (!Number.isSafeInteger(currentInPaise)) throw new Error(`The balance for ${account.data.name || "a linked account"} is invalid.`);
      const nextInPaise = currentInPaise + delta;
      if (nextInPaise < 0) {
        throw new Error(`Insufficient balance in ${account.data.name || "the selected account"}. Available ₹${(currentInPaise / 100).toFixed(2)}, required ₹${(Math.abs(delta) / 100).toFixed(2)}.`);
      }
      transaction.update(account.ref, {
        balance: nextInPaise / 100,
        balanceInPaise: nextInPaise,
        updatedAt: serverTimestamp(),
      });
    }

    transaction.update(txRef, { ...nextData, updatedAt: serverTimestamp() });
  });
  return true;
};

/** Delete an ordinary transaction and atomically undo its account balance effect. */
export const deleteTransaction = async (profileId, transactionId) => {
  if (!profileId || !transactionId) throw new Error("A transaction is required to delete this record.");
  const txRef = doc(db, "profiles", profileId, "transactions", transactionId);

  await runTransaction(db, async (transaction) => {
    const txSnapshot = await transaction.get(txRef);
    if (!txSnapshot.exists()) return;
    const existing = txSnapshot.data();
    assertEditableTransaction(existing);
    const delta = getBalanceDelta({ ...existing, amountInPaise: getAmountInPaise(existing) });
    const accountId = existing.accountId || null;
    let account = null;
    if (accountId && delta !== 0) {
      const accountRef = doc(db, "profiles", profileId, "accounts", accountId);
      const accountSnapshot = await transaction.get(accountRef);
      if (!accountSnapshot.exists()) throw new Error("The linked account no longer exists. Restore or reassign the account before deleting this transaction.");
      account = { ref: accountRef, data: accountSnapshot.data() };
    }

    if (account) {
      const currentInPaise = readAccountBalanceInPaise(account.data);
      if (!Number.isSafeInteger(currentInPaise)) throw new Error("The linked account has an invalid balance.");
      const nextInPaise = currentInPaise - delta;
      if (nextInPaise < 0) throw new Error("Deleting this transaction would make the linked account balance negative. Review later activity before deleting it.");
      transaction.update(account.ref, {
        balance: nextInPaise / 100,
        balanceInPaise: nextInPaise,
        updatedAt: serverTimestamp(),
      });
    }
    transaction.delete(txRef);
  });
  return true;
};
