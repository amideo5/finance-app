
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  setDoc,
  writeBatch,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../firebaseConfig";

const toPaise = (amount) => Math.round(Number(amount || 0) * 100);

export const addAccount = async (profileId, data) => {
  const accountRef = doc(
    collection(db, "profiles", profileId, "accounts")
  );

  const openingBalance = Number(data.openingBalance ?? data.balance ?? 0);
  const balance = Number(data.balance ?? openingBalance);

  if (
    !Number.isFinite(openingBalance) ||
    !Number.isFinite(balance) ||
    openingBalance < 0 ||
    balance < 0
  ) {
    throw new Error("Account balances must be valid, non-negative amounts.");
  }

  await setDoc(accountRef, {
    ...data,
    openingBalance: toPaise(openingBalance) / 100,
    openingBalanceInPaise: toPaise(openingBalance),
    balance: toPaise(balance) / 100,
    balanceInPaise: toPaise(balance),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return accountRef.id;
};

export const getAccounts = async (profileId) => {
  const snapshot = await getDocs(
    collection(db, "profiles", profileId, "accounts")
  );

  return snapshot.docs.map((accountDoc) => ({
    id: accountDoc.id,
    ...accountDoc.data(),
  }));
};

export const getOrCreateCashAccount = async (
  profileId,
  currency = "INR"
) => {
  const accountsRef = collection(db, "profiles", profileId, "accounts");
  const existing = await getDocs(
    query(accountsRef, where("type", "==", "cash"))
  );

  if (!existing.empty) {
    const cash =
      existing.docs.find(
        (d) => String(d.data().name || "").toLowerCase() === "cash"
      ) || existing.docs[0];

    return { id: cash.id, ...cash.data() };
  }

  const id = await addAccount(profileId, {
    name: "Cash",
    type: "cash",
    balance: 0,
    openingBalance: 0,
    currency,
  });

  return {
    id,
    name: "Cash",
    type: "cash",
    balance: 0,
    balanceInPaise: 0,
    openingBalance: 0,
    openingBalanceInPaise: 0,
    currency,
  };
};

export const backfillCashTransactions = async (
  profileId,
  cashAccountId
) => {
  const txSnapshot = await getDocs(
    collection(db, "profiles", profileId, "transactions")
  );

  const missing = txSnapshot.docs.filter((tx) => {
    const data = tx.data();
    return (
      !data.accountId &&
      String(data.paymentMode || "").toLowerCase() === "cash"
    );
  });

  for (let offset = 0; offset < missing.length; offset += 450) {
    const batch = writeBatch(db);

    missing.slice(offset, offset + 450).forEach((tx) => {
      batch.update(tx.ref, {
        accountId: cashAccountId,
        updatedAt: serverTimestamp(),
      });
    });

    await batch.commit();
  }

  return missing.length;
};

export const assignHistoricalTransactions = async (
  profileId,
  transactionIds,
  accountId
) => {
  if (
    !accountId ||
    !Array.isArray(transactionIds) ||
    transactionIds.length === 0
  ) {
    return { updated: 0, failed: 0 };
  }

  const uniqueIds = [...new Set(transactionIds)];
  let updated = 0;
  let failed = 0;

  for (const transactionId of uniqueIds) {
    try {
      const txRef = doc(
        db,
        "profiles",
        profileId,
        "transactions",
        transactionId
      );

      await updateDoc(txRef, {
        accountId,
        updatedAt: serverTimestamp(),
      });

      updated += 1;
    } catch (error) {
      console.warn(
        "Could not link historical transaction",
        transactionId,
        error
      );
      failed += 1;
    }
  }

  return { updated, failed };
};


/** Update account metadata without rewriting its transaction-derived balance. */
export const updateAccount = async (profileId, accountId, updates) => {
  if (!profileId || !accountId) throw new Error("Choose an account to update.");
  const name = String(updates.name || "").trim();
  if (!name) throw new Error("Enter an account name.");
  const ref = doc(db, "profiles", profileId, "accounts", accountId);
  const existingSnapshot = await getDoc(ref);
  if (!existingSnapshot.exists()) throw new Error("This account no longer exists.");
  const existing = existingSnapshot.data();

  if (updates.type && existing.type !== updates.type) {
    const [linkedTransactions, investments] = await Promise.all([
      getDocs(query(collection(db, "profiles", profileId, "transactions"), where("accountId", "==", accountId))),
      getDocs(collection(db, "profiles", profileId, "investments")),
    ]);
    if (existing.type === "cash" && String(existing.name || "").toLowerCase() === "cash") {
      throw new Error("The system Cash account type cannot be changed.");
    }
    if (!linkedTransactions.empty) {
      throw new Error("Account type cannot be changed after it has transaction history. You can still update the name and account label.");
    }
    for (const investmentDoc of investments.docs) {
      const ledger = await getDocs(collection(db, "profiles", profileId, "investments", investmentDoc.id, "transactions"));
      if (ledger.docs.some((entry) => entry.data().accountId === accountId || entry.data().sourceAccountId === accountId || entry.data().destinationAccountId === accountId)) {
        throw new Error("Account type cannot be changed while an investment ledger references it.");
      }
      const investment = investmentDoc.data();
      if (investment.recurringContributionSourceAccountId === accountId || investment.initialFundingAccountId === accountId) {
        throw new Error("Account type cannot be changed while an investment funding setting references it.");
      }
    }
  }

  await updateDoc(ref, {
    name,
    ...(updates.type ? { type: updates.type } : {}),
    account_number: String(updates.account_number || "").trim() || null,
    ...(updates.icon ? { icon: updates.icon } : {}),
    updatedAt: serverTimestamp(),
  });
  return true;
};

/**
 * Delete only unreferenced accounts. A financial account with transaction or
 * investment history must be reassigned first; silently deleting it would
 * strand ledger references and make balances impossible to reconcile.
 */
export const deleteAccount = async (profileId, accountId) => {
  if (!profileId || !accountId) throw new Error("Choose an account to delete.");
  const accountRef = doc(db, "profiles", profileId, "accounts", accountId);
  const [currentAccount, cashAccounts] = await Promise.all([
    getDoc(accountRef),
    getDocs(query(collection(db, "profiles", profileId, "accounts"), where("type", "==", "cash"))),
  ]);
  if (!currentAccount.exists()) return true;
  const accountData = currentAccount.data();
  const isCashAccount = cashAccounts.docs.some((item) => item.id === accountId && String(item.data().name || "").toLowerCase() === "cash");
  if (isCashAccount) throw new Error("The system Cash account cannot be deleted.");
  const balanceInPaise = Number.isSafeInteger(accountData.balanceInPaise)
    ? accountData.balanceInPaise
    : toPaise(accountData.balance);
  if (balanceInPaise !== 0) {
    throw new Error(`This account still has a balance of ₹${(balanceInPaise / 100).toFixed(2)}. Move the remaining funds out before deleting it.`);
  }

  const [transactions, investments] = await Promise.all([
    getDocs(query(collection(db, "profiles", profileId, "transactions"), where("accountId", "==", accountId))),
    getDocs(collection(db, "profiles", profileId, "investments")),
  ]);
  if (!transactions.empty) {
    throw new Error(`This account is linked to ${transactions.size} transaction(s). Reassign or remove those records before deleting the account.`);
  }

  for (const investmentDoc of investments.docs) {
    const investment = investmentDoc.data();
    if (investment.recurringContributionSourceAccountId === accountId || investment.initialFundingAccountId === accountId) {
      throw new Error(`This account is linked to ${investment.name || "an investment"}. Update the investment funding settings before deleting it.`);
    }
    const ledger = await getDocs(collection(db, "profiles", profileId, "investments", investmentDoc.id, "transactions"));
    if (ledger.docs.some((entry) => entry.data().accountId === accountId || entry.data().sourceAccountId === accountId || entry.data().destinationAccountId === accountId)) {
      throw new Error(`This account appears in the ${investment.name || "investment"} ledger. Keep the account or reconcile that investment first.`);
    }
  }

  await deleteDoc(accountRef);
  return true;
};
