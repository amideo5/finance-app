
import {
  collection,
  doc,
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
    openingBalance,
    openingBalanceInPaise: toPaise(openingBalance),
    balance,
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
