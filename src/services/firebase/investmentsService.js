import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "../../firebaseConfig";
import {
  addContributionInterval,
  calculateAccruedValueInPaise,
  calculateEstimatedDailyGrowthInPaise,
  getNextContributionSchedule,
  isValidDateKey,
  toDateKey,
} from "../calculations/investmentGrowth";
import {
  fetchLatestInvestmentPrice,
  hasStockMarketApiKey,
} from "../marketData/investmentPrices";

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

const todayKey = () => toDateKey();

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


const TERM_ASSET_CLASSES = new Set(["fixed_deposit", "recurring_deposit"]);
const MARKET_ASSET_CLASSES = new Set(["mutual_fund", "stock"]);
const DEFAULT_COMPOUNDING_FREQUENCY = "quarterly";
const FREQUENCY_OPTIONS = new Set(["daily", "monthly", "quarterly", "half_yearly", "annually"]);
const CONTRIBUTION_FREQUENCIES = new Set(["weekly", "monthly", "quarterly"]);

const scheduledLedgerId = (date) => `rd_${String(date).replace(/-/g, "")}`;
const scheduledTransferId = (investmentId, date) =>
  `rd_${investmentId}_${String(date).replace(/-/g, "")}`;


const getEffectiveValueForHolding = (holding, transactions, asOfDate = todayKey()) => {
  const storedValue = readPaise(holding, "currentValueInPaise", "currentValue");
  if (!TERM_ASSET_CLASSES.has(holding.assetClass)) return storedValue;
  const rate = Number(holding.annualInterestRatePercent);
  const startDate = holding.startDate;
  if (!Number.isFinite(rate) || rate < 0 || !isValidDateKey(startDate) || !transactions.length) return storedValue;
  const accrualDate = isValidDateKey(holding.maturityDate) && holding.maturityDate < asOfDate
    ? holding.maturityDate
    : asOfDate;
  return calculateAccruedValueInPaise(
    transactions,
    rate,
    accrualDate,
    FREQUENCY_OPTIONS.has(holding.compoundingFrequency)
      ? holding.compoundingFrequency
      : DEFAULT_COMPOUNDING_FREQUENCY,
  );
};

const investmentRevisionToken = (asset) => {
  const updatedAt = asset?.updatedAt;
  const timestamp = typeof updatedAt?.toMillis === "function"
    ? updatedAt.toMillis()
    : updatedAt instanceof Date
      ? updatedAt.getTime()
      : String(updatedAt || "");
  return JSON.stringify([
    timestamp,
    readPaise(asset, "investedAmountInPaise", "investedAmount"),
    readPaise(asset, "currentValueInPaise", "currentValue"),
    asset?.startDate || "",
    asset?.annualInterestRatePercent ?? null,
    asset?.compoundingFrequency || "",
    asset?.maturityDate || "",
    asset?.nextContributionDate || "",
    asset?.nextContributionIndex ?? null,
    asset?.lastContributionDate || "",
  ]);
};

/** Keep the persisted summary value aligned with the derived term value. This
 * lets transfer rules and older screens use the same current value without
 * adding an interest ledger row. The write is skipped if the asset changed
 * while its dated ledger was being calculated. */
const synchronizeCalculatedTermValue = async (profileId, observedAsset, calculatedValueInPaise) => {
  const storedValueInPaise = readPaise(observedAsset, "currentValueInPaise", "currentValue");
  if (storedValueInPaise === calculatedValueInPaise) return true;

  const assetRef = doc(investmentCollection(profileId), observedAsset.id);
  const observedRevision = investmentRevisionToken(observedAsset);
  return runTransaction(db, async (transaction) => {
    const currentSnapshot = await transaction.get(assetRef);
    if (!currentSnapshot.exists()) return false;
    const current = currentSnapshot.data();
    if (investmentRevisionToken(current) !== observedRevision) return false;
    transaction.update(assetRef, {
      currentValueInPaise: calculatedValueInPaise,
      currentValue: calculatedValueInPaise / 100,
      updatedAt: serverTimestamp(),
    });
    return true;
  });
};

/**
 * Apply overdue RD installments when the app opens. Each occurrence has a
 * deterministic ledger/transaction id, so concurrent refreshes cannot double
 * post an installment. A linked bank account represents the app's tracked
 * balance; it is not a real bank mandate or external debit.
 */
const processDueRecurringContributions = async (profileId, userId) => {
  if (!profileId || !userId) return;
  const today = todayKey();
  const assetSnapshot = await getDocs(investmentCollection(profileId));

  for (const assetDoc of assetSnapshot.docs) {
    const initial = assetDoc.data();
    if (
      initial.assetClass !== "recurring_deposit" ||
      initial.recurringContributionEnabled !== true ||
      !Number.isSafeInteger(initial.recurringContributionAmountInPaise) ||
      initial.recurringContributionAmountInPaise <= 0 ||
      !isValidDateKey(initial.startDate) ||
      !isValidDateKey(initial.nextContributionDate) ||
      !CONTRIBUTION_FREQUENCIES.has(initial.contributionFrequency)
    ) continue;

    let expectedDate = initial.nextContributionDate;
    if (initial.maturityDate && isValidDateKey(initial.maturityDate) && expectedDate > initial.maturityDate) {
      const assetRef = doc(investmentCollection(profileId), assetDoc.id);
      await updateDoc(assetRef, {
        recurringContributionEnabled: false,
        recurringContributionStatus: "matured",
        nextContributionDate: null,
        updatedAt: serverTimestamp(),
      });
      continue;
    }
    let iterations = 0;
    while (expectedDate <= today && iterations < 48) {
      const result = await applyScheduledContribution(
        profileId,
        userId,
        assetDoc.id,
        expectedDate,
        assetSnapshot.docs,
      );
      if (result === "insufficient" || result === "invalid_account" || result === "future") break;
      iterations += 1;

      // Re-read the holding so concurrent clients and schedule edits are respected.
      const latest = await getDocs(investmentCollection(profileId));
      const latestDoc = latest.docs.find((item) => item.id === assetDoc.id);
      if (!latestDoc) break;
      const latestData = latestDoc.data();
      if (latestData.recurringContributionEnabled !== true || !isValidDateKey(latestData.nextContributionDate)) break;
      expectedDate = latestData.nextContributionDate;
    }
  }
};

const applyScheduledContribution = async (profileId, userId, investmentId, dueDate, assetDocs) => {
  const assetRef = doc(investmentCollection(profileId), investmentId);
  const ledgerRef = doc(ledgerCollection(profileId, investmentId), scheduledLedgerId(dueDate));
  const snapshotRef = doc(snapshotCollection(profileId));

  let sourceAccountId = null;
  const transferId = scheduledTransferId(investmentId, dueDate);
  const mainTransactionRef = doc(collection(db, "profiles", profileId, "transactions"), transferId);
  const observedAsset = assetDocs.find((item) => item.id === investmentId)?.data() || {};
  sourceAccountId = observedAsset.recurringContributionSourceAccountId || null;
  const accountRef = sourceAccountId
    ? doc(db, "profiles", profileId, "accounts", sourceAccountId)
    : null;

  return runTransaction(db, async (transaction) => {
    const assetSnapshot = await transaction.get(assetRef);
    if (!assetSnapshot.exists()) return "missing";
    const asset = assetSnapshot.data();
    if (asset.recurringContributionEnabled !== true) return "future";
    if (asset.nextContributionDate !== dueDate) return "stale";

    const ledgerSnapshot = await transaction.get(ledgerRef);
    const mainTransactionSnapshot = accountRef ? await transaction.get(mainTransactionRef) : null;
    const accountSnapshot = accountRef ? await transaction.get(accountRef) : null;
    const amountInPaise = Number(asset.recurringContributionAmountInPaise || 0);
    if (!Number.isSafeInteger(amountInPaise) || amountInPaise <= 0) return "future";

    const frequency = CONTRIBUTION_FREQUENCIES.has(asset.contributionFrequency)
      ? asset.contributionFrequency
      : "monthly";
    const scheduleIndex = Math.max(1, Number(asset.nextContributionIndex || 1));
    const nextIndex = scheduleIndex + 1;
    let nextDate = addContributionInterval(asset.startDate, frequency, nextIndex);
    const maturedAfterThisPayment = Boolean(
      asset.maturityDate && isValidDateKey(asset.maturityDate) && nextDate > asset.maturityDate,
    );

    // Recover safely if a legacy/partial migration already contains the dated row.
    if (ledgerSnapshot.exists()) {
      transaction.update(assetRef, {
        nextContributionDate: maturedAfterThisPayment ? null : nextDate,
        nextContributionIndex: nextIndex,
        recurringContributionEnabled: !maturedAfterThisPayment,
        recurringContributionStatus: maturedAfterThisPayment ? "matured" : "active",
        recurringContributionError: null,
        updatedAt: serverTimestamp(),
      });
      return "already";
    }

    let account = null;
    if (accountRef) {
      if (!accountSnapshot?.exists()) {
        transaction.update(assetRef, {
          recurringContributionError: "The selected source account no longer exists.",
          recurringContributionLastAttemptDate: todayKey(),
          updatedAt: serverTimestamp(),
        });
        return "invalid_account";
      }
      account = accountSnapshot.data();
      if (String(account.type || "").toLowerCase() !== "bank") {
        transaction.update(assetRef, {
          recurringContributionError: "Choose a bank account as the RD source.",
          recurringContributionLastAttemptDate: todayKey(),
          updatedAt: serverTimestamp(),
        });
        return "invalid_account";
      }
      const balanceInPaise = readPaise(account, "balanceInPaise", "balance");
      if (!Number.isSafeInteger(balanceInPaise) || balanceInPaise < amountInPaise) {
        transaction.update(assetRef, {
          recurringContributionError: `Insufficient balance in ${account.name || "the selected account"}. The installment is still due.`,
          recurringContributionLastAttemptDate: todayKey(),
          updatedAt: serverTimestamp(),
        });
        return "insufficient";
      }
    }

    const oldValue = readPaise(asset, "currentValueInPaise", "currentValue");
    const oldInvested = readPaise(asset, "investedAmountInPaise", "investedAmount");
    const updatedAsset = withMoneyFields(
      {
        ...asset,
        lastContributionDate: dueDate,
        nextContributionDate: maturedAfterThisPayment ? null : nextDate,
        nextContributionIndex: nextIndex,
        recurringContributionEnabled: !maturedAfterThisPayment,
        recurringContributionStatus: maturedAfterThisPayment ? "matured" : "active",
        recurringContributionError: null,
        updatedAt: serverTimestamp(),
      },
      oldInvested + amountInPaise,
      oldValue + amountInPaise,
    );

    if (accountRef && account) {
      const balanceInPaise = readPaise(account, "balanceInPaise", "balance");
      if (!mainTransactionSnapshot?.exists()) {
        transaction.set(mainTransactionRef, {
          profileId,
          userId,
          type: "expense",
          kind: "investment-transfer",
          amount: amountInPaise / 100,
          amountInPaise,
          categoryId: "investment-transfer",
          category: "Investment Transfer",
          categoryIcon: "🗓️",
          paymentMode: "scheduled bank transfer",
          accountId: sourceAccountId,
          notes: `Scheduled RD installment · ${asset.name}`,
          date: dueDate,
          currency: asset.currency || "INR",
          investmentTransferId: transferId,
          investmentTransferDirection: "in",
          investmentLedgerEntryId: ledgerRef.id,
          investmentId,
          investmentName: asset.name || "Recurring Deposit",
          assetClass: "recurring_deposit",
          scheduledContribution: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      transaction.update(accountRef, {
        balance: (balanceInPaise - amountInPaise) / 100,
        balanceInPaise: balanceInPaise - amountInPaise,
        updatedAt: serverTimestamp(),
      });
      transaction.set(ledgerRef, {
        investmentId,
        investmentName: asset.name || "Recurring Deposit",
        assetClass: "recurring_deposit",
        type: "bank_transfer",
        direction: "in",
        amountInPaise,
        amount: amountInPaise / 100,
        accountId: sourceAccountId,
        sourceAccountId,
        sourceAccountName: account.name || "Bank account",
        mainTransactionId: transferId,
        transferId,
        date: dueDate,
        scheduledContribution: true,
        scheduledContributionKey: dueDate,
        notes: `Scheduled RD installment from ${account.name || "bank account"}`,
        createdAt: serverTimestamp(),
      });
    } else {
      transaction.set(ledgerRef, {
        investmentId,
        investmentName: asset.name || "Recurring Deposit",
        assetClass: "recurring_deposit",
        type: "contribution",
        amountInPaise,
        amount: amountInPaise / 100,
        date: dueDate,
        scheduledContribution: true,
        scheduledContributionKey: dueDate,
        notes: "Scheduled RD installment · no source account linked",
        createdAt: serverTimestamp(),
      });
    }

    transaction.update(assetRef, updatedAsset);
    writeSnapshot(transaction, snapshotRef, dueDate, assetDocs, investmentId, updatedAsset);
    return "created";
  });
};

const recordMarketValuation = async (profileId, investmentId, holding, quote) => {
  const assetRef = doc(investmentCollection(profileId), investmentId);
  const runDate = todayKey();
  const ledgerRef = doc(ledgerCollection(profileId, investmentId), `market_${runDate.replace(/-/g, "")}`);
  const currentValueInPaise = Math.round(Number(holding.units) * quote.price * 100);
  if (!Number.isSafeInteger(currentValueInPaise) || currentValueInPaise < 0) return false;

  return runTransaction(db, async (transaction) => {
    const assetSnapshot = await transaction.get(assetRef);
    if (!assetSnapshot.exists()) return false;
    const asset = assetSnapshot.data();
    const ledgerSnapshot = await transaction.get(ledgerRef);
    if (asset.lastMarketPriceDate === quote.date && Number(asset.lastMarketPrice) === quote.price) {
      transaction.update(assetRef, {
        lastMarketRefreshDate: runDate,
        lastMarketPriceDate: quote.date,
        marketDataLabel: quote.label,
        updatedAt: serverTimestamp(),
      });
      return false;
    }
    if (ledgerSnapshot.exists()) {
      transaction.update(assetRef, {
        lastMarketRefreshDate: runDate,
        updatedAt: serverTimestamp(),
      });
      return false;
    }

    const oldValueInPaise = readPaise(asset, "currentValueInPaise", "currentValue");
    const investedInPaise = readPaise(asset, "investedAmountInPaise", "investedAmount");
    const updatedAsset = withMoneyFields(
      {
        ...asset,
        lastMarketPrice: quote.price,
        lastMarketPriceDate: quote.date,
        lastMarketRefreshDate: runDate,
        marketDataProvider: quote.provider,
        marketDataLabel: quote.label,
        lastValuationDate: quote.date,
        updatedAt: serverTimestamp(),
      },
      investedInPaise,
      currentValueInPaise,
    );
    const deltaInPaise = currentValueInPaise - oldValueInPaise;
    transaction.update(assetRef, updatedAsset);
    transaction.set(ledgerRef, {
      investmentId,
      investmentName: asset.name || "Investment",
      assetClass: asset.assetClass || "other",
      type: "market_value",
      amountInPaise: deltaInPaise,
      amount: deltaInPaise / 100,
      newValueInPaise: currentValueInPaise,
      newValue: currentValueInPaise / 100,
      marketPrice: quote.price,
      marketPriceDate: quote.date,
      marketDataProvider: quote.provider,
      date: quote.date,
      valuationRunDate: runDate,
      notes: `Automatic market valuation · ${quote.label}`,
      createdAt: serverTimestamp(),
    });
    return true;
  });
};

const refreshDueMarketValuations = async (profileId, assetDocs) => {
  const today = todayKey();
  let recordedAny = false;
  for (const assetDoc of assetDocs) {
    const holding = { id: assetDoc.id, ...assetDoc.data() };
    if (
      !MARKET_ASSET_CLASSES.has(holding.assetClass) ||
      !holding.marketDataId ||
      !Number.isFinite(Number(holding.units)) ||
      Number(holding.units) <= 0 ||
      holding.lastMarketRefreshDate === today
    ) continue;
    if (holding.assetClass === "stock" && !hasStockMarketApiKey()) continue;

    try {
      const quote = await fetchLatestInvestmentPrice(holding);
      const recorded = await recordMarketValuation(profileId, holding.id, holding, quote);
      recordedAny = recordedAny || recorded;
    } catch (error) {
      // Market data is best-effort. A provider outage must not make portfolio
      // browsing or transactions unavailable.
      console.warn(`Market valuation skipped for ${holding.name || holding.id}:`, error instanceof Error ? error.message : error);
    }
  }
  return recordedAny;
};

const persistDailyPortfolioSnapshot = async (profileId, investments) => {
  if (!investments.length) return;
  const date = todayKey();
  const totalValueInPaise = investments.reduce((sum, holding) => sum + Number(holding.currentValueInPaise || 0), 0);
  const totalInvestedInPaise = investments.reduce((sum, holding) => sum + Number(holding.investedAmountInPaise || 0), 0);
  // One authoritative point per local calendar day. Re-write it only when a
  // market quote, contribution or other holding change alters the daily total.
  const snapshotRef = doc(snapshotCollection(profileId), `daily_${date.replace(/-/g, "")}`);
  const existing = await getDoc(snapshotRef);
  if (
    existing.exists() &&
    Number(existing.data().totalValueInPaise) === totalValueInPaise &&
    Number(existing.data().totalInvestedInPaise) === totalInvestedInPaise
  ) return;

  await setDoc(snapshotRef, {
    date,
    totalValueInPaise,
    totalInvestedInPaise,
    totalValue: totalValueInPaise / 100,
    totalInvested: totalInvestedInPaise / 100,
    createdAt: serverTimestamp(),
    source: "daily_portfolio_valuation",
  });
};

/**
 * Create a holding and its opening ledger entry.
 */
export const addInvestment = async (profileId, data) => {
  if (!profileId) throw new Error("A profile is required to create an investment.");
  if (!ASSET_CLASSES.has(data.assetClass)) throw new Error("Choose a supported asset class.");

  const name = String(data.name || "").trim();
  if (!name) throw new Error("Enter an investment name.");

  const investedAmountInPaise = Number.isSafeInteger(data.investedAmountInPaise)
    ? data.investedAmountInPaise
    : toPaise(data.investedAmount);
  const currentValueInPaise = Number.isSafeInteger(data.currentValueInPaise)
    ? data.currentValueInPaise
    : toPaise(data.currentValue ?? data.investedAmount);

  const startDate = data.startDate || data.date || todayKey();
  if (!isValidDateKey(startDate)) throw new Error("Enter the start date in YYYY-MM-DD format.");

  const isRd = data.assetClass === "recurring_deposit";
  const isTermDeposit = TERM_ASSET_CLASSES.has(data.assetClass);
  const recurringContributionAmountInPaise = Number.isSafeInteger(data.recurringContributionAmountInPaise)
    ? data.recurringContributionAmountInPaise
    : toPaise(data.recurringContributionAmount);
  const wantsScheduledContributions = isRd && recurringContributionAmountInPaise > 0;

  if (
    investedAmountInPaise < 0 ||
    currentValueInPaise < 0 ||
    (investedAmountInPaise === 0 && currentValueInPaise === 0 && !wantsScheduledContributions)
  ) {
    throw new Error(isRd
      ? "Enter an initial amount or a positive recurring installment."
      : "Enter a positive invested amount or current value.");
  }

  const annualInterestRatePercent = isTermDeposit ? Number(data.annualInterestRatePercent) : null;
  if (isTermDeposit && (!Number.isFinite(annualInterestRatePercent) || annualInterestRatePercent < 0 || annualInterestRatePercent > 100)) {
    throw new Error("Enter a valid annual interest rate between 0 and 100%.");
  }
  const compoundingFrequency = FREQUENCY_OPTIONS.has(data.compoundingFrequency)
    ? data.compoundingFrequency
    : DEFAULT_COMPOUNDING_FREQUENCY;
  const contributionFrequency = CONTRIBUTION_FREQUENCIES.has(data.contributionFrequency)
    ? data.contributionFrequency
    : "monthly";
  const tenureMonths = data.tenureMonths ? Number(data.tenureMonths) : null;
  if (tenureMonths !== null && (!Number.isInteger(tenureMonths) || tenureMonths < 1 || tenureMonths > 600)) {
    throw new Error("Tenure must be between 1 and 600 months.");
  }
  const maturityDate = data.maturityDate || (tenureMonths ? addContributionInterval(startDate, "monthly", tenureMonths) : null);
  if (maturityDate && !isValidDateKey(maturityDate)) throw new Error("Enter a valid maturity date.");
  if (isRd && wantsScheduledContributions && data.recurringContributionSourceAccountId && typeof data.recurringContributionSourceAccountId !== "string") {
    throw new Error("Choose a valid source account or no source account.");
  }

  const initialSchedule = wantsScheduledContributions
    ? getNextContributionSchedule(startDate, contributionFrequency, todayKey())
    : null;
  const scheduleFitsTenure = !maturityDate || !initialSchedule || initialSchedule.date <= maturityDate;
  const recurringContributionEnabled = wantsScheduledContributions && scheduleFitsTenure;
  const nextContributionDate = recurringContributionEnabled ? initialSchedule.date : null;
  const assetRef = doc(investmentCollection(profileId));
  const ledgerRef = doc(ledgerCollection(profileId, assetRef.id));
  const snapshotRef = doc(snapshotCollection(profileId));
  const date = startDate;

  const storedAsset = withMoneyFields(
    {
      ...data,
      name,
      assetClass: data.assetClass,
      currency: data.currency || "INR",
      startDate,
      annualInterestRatePercent,
      compoundingFrequency: isTermDeposit ? compoundingFrequency : null,
      tenureMonths,
      maturityDate,
      recurringContributionAmountInPaise: wantsScheduledContributions ? recurringContributionAmountInPaise : 0,
      recurringContributionAmount: wantsScheduledContributions ? recurringContributionAmountInPaise / 100 : 0,
      contributionFrequency: isRd ? contributionFrequency : null,
      recurringContributionSourceAccountId: wantsScheduledContributions ? (data.recurringContributionSourceAccountId || null) : null,
      recurringContributionEnabled,
      recurringContributionStatus: recurringContributionEnabled ? "active" : (wantsScheduledContributions ? "matured" : "not_configured"),
      recurringContributionError: null,
      nextContributionDate,
      nextContributionIndex: recurringContributionEnabled ? initialSchedule.index : 0,
      marketDataId: MARKET_ASSET_CLASSES.has(data.assetClass) ? (String(data.marketDataId || "").trim() || null) : null,
      marketDataProvider: data.assetClass === "mutual_fund"
        ? "mfapi"
        : data.assetClass === "stock"
          ? "alpha_vantage"
          : null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    investedAmountInPaise,
    currentValueInPaise,
  );

  delete storedAsset.date;
  delete storedAsset.id;

  const existingAssets = await getDocs(investmentCollection(profileId));
  await runTransaction(db, async (transaction) => {
    transaction.set(assetRef, storedAsset);
    const openingAmountInPaise = isTermDeposit ? investedAmountInPaise : currentValueInPaise;
    transaction.set(ledgerRef, {
      investmentId: assetRef.id,
      investmentName: name,
      assetClass: data.assetClass,
      type: "opening_balance",
      amountInPaise: openingAmountInPaise,
      amount: openingAmountInPaise / 100,
      newValueInPaise: currentValueInPaise,
      date,
      notes: isTermDeposit ? "Opening principal for accrued-value calculation" : "Opening portfolio value",
      createdAt: serverTimestamp(),
    });
    writeSnapshot(transaction, snapshotRef, date, existingAssets.docs, assetRef.id, storedAsset);
  });

  return assetRef.id;
};

/**
 * Read portfolio holdings, investment ledgers and snapshots.
 */
export const getInvestmentPortfolio = async (profileId) => {
  if (!profileId) {
    return {
      investments: [], transactions: [], snapshots: [],
      totalValueInPaise: 0, totalInvestedInPaise: 0,
    };
  }

  const userId = auth.currentUser?.uid;
  try {
    await processDueRecurringContributions(profileId, userId);
  } catch (error) {
    console.warn("Scheduled RD processing paused:", error instanceof Error ? error.message : error);
  }

  let assetsSnapshot = await getDocs(investmentCollection(profileId));
  let wroteMarketValuation = false;
  try {
    wroteMarketValuation = await refreshDueMarketValuations(profileId, assetsSnapshot.docs);
  } catch (error) {
    console.warn("Daily market valuation skipped:", error instanceof Error ? error.message : error);
  }
  // Market valuation writes do not make portfolio reading fail, and re-reading
  // ensures the returned screen reflects any quotes written above.
  if (wroteMarketValuation) assetsSnapshot = await getDocs(investmentCollection(profileId));

  const rawInvestments = assetsSnapshot.docs.map((assetDoc) => ({
    id: assetDoc.id,
    ...assetDoc.data(),
    currentValueInPaise: readPaise(assetDoc.data(), "currentValueInPaise", "currentValue"),
    investedAmountInPaise: readPaise(assetDoc.data(), "investedAmountInPaise", "investedAmount"),
  }));

  const transactionGroups = await Promise.all(
    rawInvestments.map(async (investment) => {
      const txSnapshot = await getDocs(ledgerCollection(profileId, investment.id));
      return txSnapshot.docs.map((txDoc) => ({
        id: txDoc.id,
        investmentId: investment.id,
        investmentName: investment.name,
        assetClass: investment.assetClass,
        ...txDoc.data(),
      }));
    }),
  );

  const today = todayKey();
  const transactions = transactionGroups.flat().sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || "")),
  );
  const enrichedInvestments = rawInvestments.map((holding) => {
    const holdingTransactions = transactions.filter((entry) => entry.investmentId === holding.id);
    const effectiveValue = getEffectiveValueForHolding(holding, holdingTransactions, today);
    const isTermDeposit = TERM_ASSET_CLASSES.has(holding.assetClass)
      && Number.isFinite(Number(holding.annualInterestRatePercent))
      && isValidDateKey(holding.startDate);
    const frequency = FREQUENCY_OPTIONS.has(holding.compoundingFrequency)
      ? holding.compoundingFrequency
      : DEFAULT_COMPOUNDING_FREQUENCY;
    const dailyGrowth = isTermDeposit
      ? (isValidDateKey(holding.maturityDate) && holding.maturityDate < today
        ? 0
        : calculateEstimatedDailyGrowthInPaise(holdingTransactions, Number(holding.annualInterestRatePercent), today, frequency))
      : 0;
    let projectedMaturityValueInPaise = null;
    if (isTermDeposit && isValidDateKey(holding.maturityDate) && holding.maturityDate >= today) {
      const projectedFlows = [...holdingTransactions];
      if (holding.assetClass === "recurring_deposit" && holding.recurringContributionEnabled === true) {
        const installment = Number(holding.recurringContributionAmountInPaise || 0);
        const nextIndex = Math.max(1, Number(holding.nextContributionIndex || 1));
        const nextDate = holding.nextContributionDate;
        if (installment > 0 && isValidDateKey(nextDate)) {
          for (let index = nextIndex, count = 0; count < 600; index += 1, count += 1) {
            const projectedDate = addContributionInterval(holding.startDate, holding.contributionFrequency || "monthly", index);
            if (projectedDate > holding.maturityDate) break;
            if (projectedDate >= nextDate) {
              projectedFlows.push({
                type: "contribution",
                date: projectedDate,
                amountInPaise: installment,
                amount: installment / 100,
              });
            }
          }
        }
      }
      projectedMaturityValueInPaise = calculateAccruedValueInPaise(
        projectedFlows,
        Number(holding.annualInterestRatePercent),
        holding.maturityDate,
        frequency,
      );
    }
    return {
      ...holding,
      currentValueInPaise: effectiveValue,
      currentValue: effectiveValue / 100,
      estimatedDailyGrowthInPaise: dailyGrowth,
      estimatedDailyGrowth: dailyGrowth / 100,
      projectedMaturityValueInPaise,
      projectedMaturityValue: projectedMaturityValueInPaise === null ? null : projectedMaturityValueInPaise / 100,
      isAutomaticallyValued: isTermDeposit || (
        MARKET_ASSET_CLASSES.has(holding.assetClass) && Boolean(holding.marketDataId) &&
        Number(holding.units) > 0 && Boolean(holding.lastMarketPriceDate)
      ),
      valuationMethod: isTermDeposit
        ? "estimated_interest_accrual"
        : holding.lastMarketPriceDate
          ? "market_price"
          : "manual",
    };
  });

  const rawById = new Map(rawInvestments.map((holding) => [holding.id, holding]));
  for (const holding of enrichedInvestments) {
    if (
      !TERM_ASSET_CLASSES.has(holding.assetClass) ||
      !Number.isFinite(Number(holding.annualInterestRatePercent)) ||
      !isValidDateKey(holding.startDate)
    ) continue;
    const observed = rawById.get(holding.id);
    if (!observed) continue;
    try {
      await synchronizeCalculatedTermValue(profileId, observed, holding.currentValueInPaise);
    } catch (error) {
      // Derived value remains usable for display even if read-only users or a
      // transient Rules/network issue prevent summary-field synchronization.
      console.warn(`Could not synchronize accrued value for ${holding.name}:`, error instanceof Error ? error.message : error);
    }
  }

  try {
    await persistDailyPortfolioSnapshot(profileId, enrichedInvestments);
  } catch (error) {
    console.warn("Could not persist the daily portfolio snapshot:", error instanceof Error ? error.message : error);
  }

  const snapshot = await getDocs(snapshotCollection(profileId));
  const snapshotsByDate = new Map();
  snapshot.docs.forEach((item) => {
    const row = { id: item.id, ...item.data() };
    const current = snapshotsByDate.get(row.date);
    // Prefer the canonical daily valuation point over older per-action snapshots.
    if (!current || item.id.startsWith("daily_") || !String(current.id || "").startsWith("daily_")) {
      snapshotsByDate.set(row.date, row);
    }
  });
  const snapshots = [...snapshotsByDate.values()]
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

  return {
    investments: enrichedInvestments,
    transactions,
    snapshots,
    totalValueInPaise: enrichedInvestments.reduce((sum, item) => sum + item.currentValueInPaise, 0),
    totalInvestedInPaise: enrichedInvestments.reduce((sum, item) => sum + item.investedAmountInPaise, 0),
  };
};

/** Update growth terms and quote-provider settings for an existing holding. */
export const updateInvestmentSettings = async (profileId, investmentId, settings) => {
  if (!profileId || !investmentId) throw new Error("Choose an investment first.");
  const assetRef = doc(investmentCollection(profileId), investmentId);
  const existingLedger = await getDocs(ledgerCollection(profileId, investmentId));
  const openingDoc = existingLedger.docs.find((item) => item.data()?.type === "opening_balance");

  const startDate = settings.startDate || todayKey();
  if (!isValidDateKey(startDate)) throw new Error("Enter the start date in YYYY-MM-DD format.");
  const assetSnapshot = await getDocs(investmentCollection(profileId));
  const observed = assetSnapshot.docs.find((item) => item.id === investmentId)?.data();
  if (!observed) throw new Error("This investment no longer exists.");

  const isTermDeposit = TERM_ASSET_CLASSES.has(observed.assetClass);
  const isRd = observed.assetClass === "recurring_deposit";
  const isMarketAsset = MARKET_ASSET_CLASSES.has(observed.assetClass);
  const annualRate = Number(settings.annualInterestRatePercent);
  if (isTermDeposit && (!Number.isFinite(annualRate) || annualRate < 0 || annualRate > 100)) {
    throw new Error("Enter an annual interest rate between 0 and 100%.");
  }
  const frequency = FREQUENCY_OPTIONS.has(settings.compoundingFrequency)
    ? settings.compoundingFrequency
    : DEFAULT_COMPOUNDING_FREQUENCY;
  const contributionFrequency = CONTRIBUTION_FREQUENCIES.has(settings.contributionFrequency)
    ? settings.contributionFrequency
    : "monthly";
  const recurringAmount = Number.isSafeInteger(settings.recurringContributionAmountInPaise)
    ? settings.recurringContributionAmountInPaise
    : toPaise(settings.recurringContributionAmount);
  if (isRd && recurringAmount < 0) throw new Error("RD installment cannot be negative.");
  const enabled = isRd && settings.recurringContributionEnabled === true && recurringAmount > 0;
  const tenureMonths = settings.tenureMonths ? Number(settings.tenureMonths) : null;
  if (tenureMonths !== null && (!Number.isInteger(tenureMonths) || tenureMonths < 1 || tenureMonths > 600)) {
    throw new Error("Tenure must be between 1 and 600 months.");
  }
  const maturityDate = settings.maturityDate || (tenureMonths ? addContributionInterval(startDate, "monthly", tenureMonths) : null);
  if (maturityDate && !isValidDateKey(maturityDate)) throw new Error("Enter a valid maturity date.");
  const sameActiveSchedule = observed.recurringContributionEnabled === true
    && observed.startDate === startDate
    && observed.contributionFrequency === contributionFrequency
    && isValidDateKey(observed.nextContributionDate);
  const recalculatedSchedule = enabled && !sameActiveSchedule
    ? getNextContributionSchedule(startDate, contributionFrequency, todayKey())
    : null;
  const proposedNextDate = enabled
    ? (sameActiveSchedule ? observed.nextContributionDate : recalculatedSchedule.date)
    : null;
  const canContributeBeforeMaturity = !maturityDate || !isValidDateKey(maturityDate) || proposedNextDate <= maturityDate;
  const scheduleEnabled = enabled && canContributeBeforeMaturity;
  const nextContributionIndex = scheduleEnabled
    ? (sameActiveSchedule ? Math.max(1, Number(observed.nextContributionIndex || 1)) : recalculatedSchedule.index)
    : 0;
  const nextContributionDate = scheduleEnabled ? proposedNextDate : null;
  const marketDataId = isMarketAsset ? (String(settings.marketDataId || "").trim() || null) : null;
  const marketDataChanged = marketDataId !== (observed.marketDataId || null);

  await runTransaction(db, async (transaction) => {
    const assetDoc = await transaction.get(assetRef);
    if (!assetDoc.exists()) throw new Error("This investment no longer exists.");
    const current = assetDoc.data();
    const update = {
      startDate,
      ...(isTermDeposit ? {
        annualInterestRatePercent: annualRate,
        compoundingFrequency: frequency,
        tenureMonths,
        maturityDate,
      } : {}),
      ...(isRd ? {
        recurringContributionAmountInPaise: recurringAmount,
        recurringContributionAmount: recurringAmount / 100,
        contributionFrequency,
        recurringContributionSourceAccountId: scheduleEnabled ? (settings.recurringContributionSourceAccountId || null) : null,
        recurringContributionSourceAccountName: scheduleEnabled ? (settings.recurringContributionSourceAccountName || null) : null,
        recurringContributionEnabled: scheduleEnabled,
        recurringContributionStatus: scheduleEnabled ? "active" : (enabled ? "matured" : (current.recurringContributionStatus === "matured" ? "matured" : "paused")),
        recurringContributionError: null,
        nextContributionDate,
        nextContributionIndex,
      } : {}),
      ...(isMarketAsset ? {
        marketDataId,
        marketDataProvider: current.assetClass === "mutual_fund" ? "mfapi" : "alpha_vantage",
        ...(marketDataChanged ? {
          lastMarketRefreshDate: null,
          lastMarketPriceDate: null,
          lastMarketPrice: null,
          marketDataLabel: null,
        } : {}),
      } : {}),
      updatedAt: serverTimestamp(),
    };
    const currentOpening = isTermDeposit && openingDoc
      ? await transaction.get(openingDoc.ref)
      : null;
    transaction.update(assetRef, update);

    if (isTermDeposit && openingDoc && currentOpening?.exists()) {
      const principal = readPaise(current, "investedAmountInPaise", "investedAmount");
      transaction.update(openingDoc.ref, {
        date: startDate,
        amountInPaise: principal,
        amount: principal / 100,
        newValueInPaise: readPaise(current, "currentValueInPaise", "currentValue"),
        notes: "Opening principal for accrued-value calculation",
      });
    }
  });
  return true;
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