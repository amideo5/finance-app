import {
  collection,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../firebaseConfig";

const ASSET_CLASSES = new Set([
  "fixed_deposit",
  "recurring_deposit",
  "mutual_fund",
  "stock",
  "other",
]);

const ACTIVITY_TYPES = new Set([
  "contribution",
  "withdrawal",
  "interest",
  "gain",
  "loss",
  "market_value",
]);

const toPaise = (value) => Math.round(Number(value || 0) * 100);

const readPaise = (data, paiseKey, rupeeKey) =>
  Number.isSafeInteger(data?.[paiseKey])
    ? data[paiseKey]
    : toPaise(data?.[rupeeKey]);

const withMoneyFields = (data, investedAmountInPaise, currentValueInPaise) => ({
  ...data,
  investedAmountInPaise,
  currentValueInPaise,
  investedAmount: investedAmountInPaise / 100,
  currentValue: currentValueInPaise / 100,
});

const investmentCollection = (profileId) =>
  collection(db, "profiles", profileId, "investments");

const snapshotCollection = (profileId) =>
  collection(db, "profiles", profileId, "investmentSnapshots");

const ledgerCollection = (profileId, investmentId) =>
  collection(
    db,
    "profiles",
    profileId,
    "investments",
    investmentId,
    "transactions",
  );

const todayKey = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

/**
 * IMPORTANT:
 * Firestore Transaction.get() reads document references, not collection
 * references. Pass previously fetched holding documents into this helper.
 *
 * Snapshots are approximate if another device changes the portfolio
 * concurrently. See the note below about atomic portfolio summaries.
 */
function writeSnapshot(
  transaction,
  snapshotRef,
  date,
  assetDocs,
  changedInvestmentId,
  changedInvestment,
) {
  let totalValueInPaise = 0;
  let totalInvestedInPaise = 0;
  let found = false;

  for (const assetDoc of assetDocs) {
    const asset =
      assetDoc.id === changedInvestmentId && changedInvestment
        ? changedInvestment
        : assetDoc.data();

    if (assetDoc.id === changedInvestmentId) found = true;

    totalValueInPaise += readPaise(
      asset,
      "currentValueInPaise",
      "currentValue",
    );

    totalInvestedInPaise += readPaise(
      asset,
      "investedAmountInPaise",
      "investedAmount",
    );
  }

  if (!found && changedInvestment) {
    totalValueInPaise += readPaise(
      changedInvestment,
      "currentValueInPaise",
      "currentValue",
    );

    totalInvestedInPaise += readPaise(
      changedInvestment,
      "investedAmountInPaise",
      "investedAmount",
    );
  }

  transaction.set(snapshotRef, {
    date: date || todayKey(),
    totalValueInPaise,
    totalInvestedInPaise,
    totalValue: totalValueInPaise / 100,
    totalInvested: totalInvestedInPaise / 100,
    createdAt: serverTimestamp(),
  });
}

/**
 * Create a holding and its opening ledger entry.
 */
export const addInvestment = async (profileId, data) => {
  if (!profileId) {
    throw new Error("A profile is required to create an investment.");
  }

  if (!ASSET_CLASSES.has(data.assetClass)) {
    throw new Error("Choose a supported asset class.");
  }

  const name = String(data.name || "").trim();

  if (!name) {
    throw new Error("Enter an investment name.");
  }

  const investedAmountInPaise = Number.isSafeInteger(data.investedAmountInPaise)
    ? data.investedAmountInPaise
    : toPaise(data.investedAmount);

  const currentValueInPaise = Number.isSafeInteger(data.currentValueInPaise)
    ? data.currentValueInPaise
    : toPaise(data.currentValue ?? data.investedAmount);

  if (
    investedAmountInPaise < 0 ||
    currentValueInPaise < 0 ||
    (investedAmountInPaise === 0 && currentValueInPaise === 0)
  ) {
    throw new Error("Enter a positive invested amount or current value.");
  }

  const assetRef = doc(investmentCollection(profileId));
  const ledgerRef = doc(ledgerCollection(profileId, assetRef.id));
  const snapshotRef = doc(snapshotCollection(profileId));
  const date = data.date || todayKey();

  const storedAsset = withMoneyFields(
    {
      ...data,
      name,
      assetClass: data.assetClass,
      currency: data.currency || "INR",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    investedAmountInPaise,
    currentValueInPaise,
  );

  delete storedAsset.date;
  delete storedAsset.id;

  // FIX: Fetch collections with getDocs(), not transaction.get().
  // This query is outside the transaction because Transaction.get() does not
  // accept a CollectionReference.
  const existingAssets = await getDocs(investmentCollection(profileId));

  await runTransaction(db, async (transaction) => {
    transaction.set(assetRef, storedAsset);

    transaction.set(ledgerRef, {
      investmentId: assetRef.id,
      investmentName: name,
      assetClass: data.assetClass,
      type: "opening_balance",
      amountInPaise: currentValueInPaise,
      amount: currentValueInPaise / 100,
      newValueInPaise: currentValueInPaise,
      date,
      notes: "Opening portfolio value",
      createdAt: serverTimestamp(),
    });

    writeSnapshot(
      transaction,
      snapshotRef,
      date,
      existingAssets.docs,
      assetRef.id,
      storedAsset,
    );
  });

  return assetRef.id;
};

/**
 * Read portfolio holdings, investment ledgers and snapshots.
 */
export const getInvestmentPortfolio = async (profileId) => {
  if (!profileId) {
    return {
      investments: [],
      transactions: [],
      snapshots: [],
      totalValueInPaise: 0,
      totalInvestedInPaise: 0,
    };
  }

  const assetsSnapshot = await getDocs(investmentCollection(profileId));

  const investments = assetsSnapshot.docs.map((assetDoc) => ({
    id: assetDoc.id,
    ...assetDoc.data(),
    currentValueInPaise: readPaise(
      assetDoc.data(),
      "currentValueInPaise",
      "currentValue",
    ),
    investedAmountInPaise: readPaise(
      assetDoc.data(),
      "investedAmountInPaise",
      "investedAmount",
    ),
  }));

  const transactionGroups = await Promise.all(
    investments.map(async (investment) => {
      const txSnapshot = await getDocs(
        ledgerCollection(profileId, investment.id),
      );

      return txSnapshot.docs.map((txDoc) => ({
        id: txDoc.id,
        investmentId: investment.id,
        investmentName: investment.name,
        assetClass: investment.assetClass,
        ...txDoc.data(),
      }));
    }),
  );

  const snapshot = await getDocs(snapshotCollection(profileId));

  const transactions = transactionGroups
    .flat()
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  const snapshots = snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

  return {
    investments,
    transactions,
    snapshots,
    totalValueInPaise: investments.reduce(
      (sum, item) => sum + item.currentValueInPaise,
      0,
    ),
    totalInvestedInPaise: investments.reduce(
      (sum, item) => sum + item.investedAmountInPaise,
      0,
    ),
  };
};

/**
 * Record a portfolio-only contribution, withdrawal, interest, gain, loss
 * or market-value update. Does not write to daily transactions.
 */
export const recordInvestmentActivity = async (
  profileId,
  investmentId,
  data,
) => {
  if (!profileId || !investmentId) {
    throw new Error("Choose an investment first.");
  }

  if (!ACTIVITY_TYPES.has(data.type)) {
    throw new Error("Choose a supported investment activity.");
  }

  const amountInPaise = Number.isSafeInteger(data.amountInPaise)
    ? data.amountInPaise
    : toPaise(data.amount);

  const newValueInPaise = Number.isSafeInteger(data.newValueInPaise)
    ? data.newValueInPaise
    : toPaise(data.newValue);

  if (
    data.type === "market_value"
      ? newValueInPaise < 0
      : amountInPaise <= 0
  ) {
    throw new Error("Enter a valid positive amount or market value.");
  }

  const assetRef = doc(
    db,
    "profiles",
    profileId,
    "investments",
    investmentId,
  );

  const ledgerRef = doc(ledgerCollection(profileId, investmentId));
  const snapshotRef = doc(snapshotCollection(profileId));
  const date = data.date || todayKey();

  // FIX: The collection query is separate from the Firestore transaction.
  const existingAssets = await getDocs(investmentCollection(profileId));

  await runTransaction(db, async (transaction) => {
    // A document reference is valid here.
    const assetSnapshot = await transaction.get(assetRef);

    if (!assetSnapshot.exists()) {
      throw new Error("This investment no longer exists.");
    }

    const asset = assetSnapshot.data();
    const oldValue = readPaise(
      asset,
      "currentValueInPaise",
      "currentValue",
    );
    const oldInvested = readPaise(
      asset,
      "investedAmountInPaise",
      "investedAmount",
    );

    let currentValue = oldValue;
    let investedAmount = oldInvested;
    let signedAmount = amountInPaise;

    switch (data.type) {
      case "contribution":
        currentValue += amountInPaise;
        investedAmount += amountInPaise;
        break;

      case "withdrawal":
        if (amountInPaise > oldValue) {
          throw new Error(
            "Withdrawal cannot exceed the investment's current value.",
          );
        }
        currentValue -= amountInPaise;
        investedAmount = Math.max(0, investedAmount - amountInPaise);
        signedAmount = -amountInPaise;
        break;

      case "interest":
      case "gain":
        currentValue += amountInPaise;
        break;

      case "loss":
        if (amountInPaise > oldValue) {
          throw new Error(
            "Loss cannot exceed the investment's current value.",
          );
        }
        currentValue -= amountInPaise;
        signedAmount = -amountInPaise;
        break;

      case "market_value":
        currentValue = newValueInPaise;
        signedAmount = newValueInPaise - oldValue;
        break;
    }

    const updatedAsset = withMoneyFields(
      {
        ...asset,
        updatedAt: serverTimestamp(),
        lastValuationDate: date,
      },
      investedAmount,
      currentValue,
    );

    transaction.update(assetRef, updatedAsset);

    transaction.set(ledgerRef, {
      investmentId,
      investmentName: asset.name || "Investment",
      assetClass: asset.assetClass || "other",
      type: data.type,
      amountInPaise: signedAmount,
      amount: signedAmount / 100,
      ...(data.type === "market_value"
        ? {
            newValueInPaise,
            newValue: newValueInPaise / 100,
          }
        : {}),
      date,
      notes: String(data.notes || "").trim() || null,
      createdAt: serverTimestamp(),
    });

    writeSnapshot(
      transaction,
      snapshotRef,
      date,
      existingAssets.docs,
      investmentId,
      updatedAsset,
    );
  });

  return ledgerRef.id;
};

/**
 * Redeem investment value into a linked bank account.
 */
export const transferFromInvestment = async (
  profileId,
  userId,
  data,
) => {
  if (!profileId || !userId || !data.investmentId || !data.accountId) {
    throw new Error("Choose an investment and destination bank account first.");
  }

  const amountInPaise = Number.isSafeInteger(data.amountInPaise)
    ? data.amountInPaise
    : toPaise(data.amount);

  if (!Number.isSafeInteger(amountInPaise) || amountInPaise <= 0) {
    throw new Error("Transfer amount must be positive.");
  }

  const accountRef = doc(
    db,
    "profiles",
    profileId,
    "accounts",
    data.accountId,
  );

  const mainTransactionRef = doc(
    collection(db, "profiles", profileId, "transactions"),
  );

  const assetRef = doc(
    db,
    "profiles",
    profileId,
    "investments",
    data.investmentId,
  );

  const ledgerRef = doc(ledgerCollection(profileId, data.investmentId));
  const snapshotRef = doc(snapshotCollection(profileId));
  const date = data.date || todayKey();
  const transferId = mainTransactionRef.id;

  // FIX: Fetch the collection outside the transaction.
  const existingAssets = await getDocs(investmentCollection(profileId));

  await runTransaction(db, async (transaction) => {
    const accountSnapshot = await transaction.get(accountRef);
    const assetSnapshot = await transaction.get(assetRef);

    if (!accountSnapshot.exists()) {
      throw new Error("The selected bank account no longer exists.");
    }

    if (!assetSnapshot.exists()) {
      throw new Error("The selected investment no longer exists.");
    }

    const account = accountSnapshot.data();
    const asset = assetSnapshot.data();

    if (String(account.type || "").toLowerCase() !== "bank") {
      throw new Error("Choose a linked bank account as the destination.");
    }

    const currentValueInPaise = readPaise(
      asset,
      "currentValueInPaise",
      "currentValue",
    );

    if (amountInPaise > currentValueInPaise) {
      throw new Error(
        "Withdrawal cannot exceed the investment's current value.",
      );
    }

    const currentBalanceInPaise = readPaise(
      account,
      "balanceInPaise",
      "balance",
    );

    if (!Number.isSafeInteger(currentBalanceInPaise)) {
      throw new Error("The bank account balance is invalid.");
    }

    const nextBalance = currentBalanceInPaise + amountInPaise;

    const updatedAsset = withMoneyFields(
      {
        ...asset,
        updatedAt: serverTimestamp(),
        lastWithdrawalDate: date,
      },
      Math.max(
        0,
        readPaise(asset, "investedAmountInPaise", "investedAmount") -
          amountInPaise,
      ),
      currentValueInPaise - amountInPaise,
    );

    transaction.update(accountRef, {
      balance: nextBalance / 100,
      balanceInPaise: nextBalance,
      updatedAt: serverTimestamp(),
    });

    transaction.update(assetRef, updatedAsset);

    transaction.set(mainTransactionRef, {
      profileId,
      userId,
      type: "income",
      kind: "investment-transfer",
      amount: amountInPaise / 100,
      amountInPaise,
      categoryId: "investment-withdrawal",
      category: "Investment Withdrawal",
      categoryIcon: "📤",
      paymentMode: "bank transfer",
      accountId: data.accountId,
      notes: String(data.notes || "").trim() || `Withdrawal from ${asset.name}`,
      date,
      currency: data.currency || "INR",
      investmentTransferId: transferId,
      investmentTransferDirection: "out",
      investmentLedgerEntryId: ledgerRef.id,
      investmentId: data.investmentId,
      investmentName: asset.name || "Investment",
      assetClass: asset.assetClass || "other",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    transaction.set(ledgerRef, {
      investmentId: data.investmentId,
      investmentName: asset.name || "Investment",
      assetClass: asset.assetClass || "other",
      type: "bank_transfer",
      direction: "out",
      amountInPaise: -amountInPaise,
      amount: -amountInPaise / 100,
      accountId: data.accountId,
      destinationAccountId: data.accountId,
      destinationAccountName: account.name || "Bank account",
      mainTransactionId: transferId,
      transferId,
      date,
      notes: String(data.notes || "").trim() || `Transfer to ${account.name || "bank account"}`,
      createdAt: serverTimestamp(),
    });

    writeSnapshot(
      transaction,
      snapshotRef,
      date,
      existingAssets.docs,
      data.investmentId,
      updatedAsset,
    );
  });

  return {
    transferId,
    transactionId: transferId,
    ledgerTransactionId: ledgerRef.id,
  };
};

/**
 * Move money from a linked bank account into an investment.
 */
export const transferToInvestment = async (
  profileId,
  userId,
  data,
) => {
  if (!profileId || !userId || !data.investmentId || !data.accountId) {
    throw new Error("Choose a bank account and investment first.");
  }

  const amountInPaise = Number.isSafeInteger(data.amountInPaise)
    ? data.amountInPaise
    : toPaise(data.amount);

  if (!Number.isSafeInteger(amountInPaise) || amountInPaise <= 0) {
    throw new Error("Transfer amount must be positive.");
  }

  const accountRef = doc(
    db,
    "profiles",
    profileId,
    "accounts",
    data.accountId,
  );

  const mainTransactionRef = doc(
    collection(db, "profiles", profileId, "transactions"),
  );

  const assetRef = doc(
    db,
    "profiles",
    profileId,
    "investments",
    data.investmentId,
  );

  const ledgerRef = doc(ledgerCollection(profileId, data.investmentId));
  const snapshotRef = doc(snapshotCollection(profileId));
  const date = data.date || todayKey();
  const transferId = mainTransactionRef.id;

  // FIX: Query the collection outside the transaction.
  const existingAssets = await getDocs(investmentCollection(profileId));

  await runTransaction(db, async (transaction) => {
    const accountSnapshot = await transaction.get(accountRef);
    const assetSnapshot = await transaction.get(assetRef);

    if (!accountSnapshot.exists()) {
      throw new Error("The selected bank account no longer exists.");
    }

    if (!assetSnapshot.exists()) {
      throw new Error("The selected investment no longer exists.");
    }

    const account = accountSnapshot.data();
    const asset = assetSnapshot.data();

    if (String(account.type || "").toLowerCase() !== "bank") {
      throw new Error("Choose a linked bank account as the source.");
    }

    const balanceInPaise = readPaise(
      account,
      "balanceInPaise",
      "balance",
    );

    if (!Number.isSafeInteger(balanceInPaise) || balanceInPaise < amountInPaise) {
      throw new Error(
        `Insufficient balance in ${account.name || "the selected account"}.`,
      );
    }

    const oldValue = readPaise(
      asset,
      "currentValueInPaise",
      "currentValue",
    );

    const oldInvested = readPaise(
      asset,
      "investedAmountInPaise",
      "investedAmount",
    );

    const updatedAsset = withMoneyFields(
      {
        ...asset,
        updatedAt: serverTimestamp(),
        lastContributionDate: date,
      },
      oldInvested + amountInPaise,
      oldValue + amountInPaise,
    );

    const nextBalance = balanceInPaise - amountInPaise;

    transaction.update(accountRef, {
      balance: nextBalance / 100,
      balanceInPaise: nextBalance,
      updatedAt: serverTimestamp(),
    });

    transaction.update(assetRef, updatedAsset);

    transaction.set(mainTransactionRef, {
      profileId,
      userId,
      type: "expense",
      kind: "investment-transfer",
      amount: amountInPaise / 100,
      amountInPaise,
      categoryId: "investment-transfer",
      category: "Investment Transfer",
      categoryIcon: "📈",
      paymentMode: "bank transfer",
      accountId: data.accountId,
      notes: String(data.notes || "").trim() || `Transfer to ${asset.name}`,
      date,
      currency: data.currency || "INR",
      investmentTransferId: transferId,
      investmentTransferDirection: "in",
      investmentLedgerEntryId: ledgerRef.id,
      investmentId: data.investmentId,
      investmentName: asset.name || "Investment",
      assetClass: asset.assetClass || "other",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    transaction.set(ledgerRef, {
      investmentId: data.investmentId,
      investmentName: asset.name || "Investment",
      assetClass: asset.assetClass || "other",
      type: "bank_transfer",
      direction: "in",
      amountInPaise,
      amount: amountInPaise / 100,
      accountId: data.accountId,
      sourceAccountId: data.accountId,
      sourceAccountName: account.name || "Bank account",
      mainTransactionId: transferId,
      transferId,
      date,
      notes: String(data.notes || "").trim() || `Transfer from ${account.name || "bank account"}`,
      createdAt: serverTimestamp(),
    });

    writeSnapshot(
      transaction,
      snapshotRef,
      date,
      existingAssets.docs,
      data.investmentId,
      updatedAsset,
    );
  });

  return {
    transferId,
    transactionId: transferId,
    ledgerTransactionId: ledgerRef.id,
  };
};