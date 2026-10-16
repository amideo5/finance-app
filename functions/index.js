const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { assertPaise, participantSum, validateEqualShares, makeObligations, allObligationsPaid, splitStatus, obligationIndex } = require("./splitDomain");

admin.initializeApp();

const db = admin.firestore();
const timestamp = () => FieldValue.serverTimestamp();
const fail = (code, message) => { throw new HttpsError(code, message); };
const stableId = (...parts) => crypto.createHash("sha256").update(parts.join("\u0000")).digest("hex");

function requireAuth(context) {
  if (!context.auth || !context.auth.uid) fail("unauthenticated", "Sign in to manage shared expenses.");
  return context.auth.uid;
}

function assertString(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail("invalid-argument", `${label} is required.`);
  return value.trim();
}

function assertDocumentId(value, label) {
  const id = assertString(value, label);
  if (id.includes("/") || id.length > 1500) fail("invalid-argument", `${label} is invalid.`);
  return id;
}

function rupeesToPaise(amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return null;
  const paise = Math.round(amount * 100);
  return Number.isSafeInteger(paise) && Math.abs(amount * 100 - paise) < 1e-6 ? paise : null;
}

function profilePath(profileId) { return `profiles/${profileId}`; }
function transactionPath(profileId, transactionId) { return `${profilePath(profileId)}/transactions/${transactionId}`; }
function sourceLockPath(profileId, transactionId) { return `splitSourceLocks/${profileId}/transactions/${transactionId}`; }

async function defaultProfileRefs(userIds) {
  const result = new Map();
  for (const uid of [...new Set(userIds)]) {
    const snapshot = await db.collection("profiles").where("userId", "==", uid).get();
    if (snapshot.empty) fail("failed-precondition", `A finance profile is required for participant ${uid}.`);
    const profiles = snapshot.docs.sort((a, b) => a.id.localeCompare(b.id));
    const selected = profiles.find((profile) => profile.get("isDefault") === true) || profiles[0];
    result.set(uid, selected.ref);
  }
  return result;
}

function makeTransaction({ profileId, userId, type, amountInPaise, category, sourceCategory, sourceCategoryId, kind, splitId, sourceProfileId, sourceTransactionId, settlementId, counterpartyUserId, date }) {
  const id = kind === "allocation"
    ? `split_alloc_${stableId(splitId, userId).slice(0, 40)}`
    : `split_pay_${stableId(splitId, settlementId, userId).slice(0, 40)}`;
  const ref = db.doc(transactionPath(profileId, id));
  const data = {
    profileId,
    userId,
    type,
    amount: amountInPaise / 100,
    amountInPaise,
    currency: "INR",
    category,
    categoryId: kind === "allocation" ? "split-expense-allocation" : "split-repayment",
    categoryIcon: kind === "allocation" ? "🧾" : "↔️",
    paymentMode: kind === "allocation" ? "shared-expense-allocation" : "split-repayment",
    accountId: null,
    notes: kind === "allocation" ? "Final shared expense allocation" : "Accepted split repayment",
    date,
    kind,
    splitId,
    settlementId: settlementId || null,
    sourceProfileId,
    sourceTransactionId,
    sourceCategory: sourceCategory || null,
    sourceCategoryId: sourceCategoryId || null,
    counterpartyUserId: counterpartyUserId || null,
    createdAt: timestamp(),
    updatedAt: timestamp(),
    serverGenerated: true,
  };
  return { ref, data };
}

function defaultProfileForTxn(profileRefs, userId) {
  const ref = profileRefs.get(userId);
  if (!ref) fail("failed-precondition", `Could not resolve default profile for ${userId}.`);
  return ref;
}

exports.createSharedExpense = onCall(async (request) => {
  const data = request.data || {};
  const uid = requireAuth(request);
  const sourceProfileId = assertDocumentId(data.sourceProfileId, "Source profile");
  const sourceTransactionId = assertDocumentId(data.sourceTransactionId, "Source transaction");
  const title = assertString(data.title, "Expense title");
  if (title.length > 120) fail("invalid-argument", "Expense title must be 120 characters or fewer.");
  const splitType = data.type;
  if (!['equal', 'custom'].includes(splitType)) fail("invalid-argument", "Split type must be equal or custom.");
  if (!Array.isArray(data.participants) || data.participants.some((participant) => !participant || typeof participant !== "object")) {
    fail("invalid-argument", "Allocation participants are required.");
  }
  const participants = data.participants.map((participant) => ({
    userId: assertDocumentId(participant.userId, "Participant UID"),
    displayName: typeof participant.displayName === "string" ? participant.displayName.slice(0, 100) : "",
    shareAmountInPaise: assertPaise(participant.shareAmountInPaise, "Participant share", true),
  }));
  if (participantSum(participants) <= 0) fail("invalid-argument", "The allocated total must be positive.");
  const participantIds = participants.map((participant) => participant.userId);
  const sourceRef = db.doc(transactionPath(sourceProfileId, sourceTransactionId));
  const profileRef = db.doc(profilePath(sourceProfileId));
  const lockRef = db.doc(sourceLockPath(sourceProfileId, sourceTransactionId));
  const splitRef = db.collection("splits").doc();
  const friendRefs = participantIds.filter((participantId) => participantId !== uid)
    .map((participantId) => db.doc(`friends/${uid}_${participantId}`));
  const allocationProfiles = await defaultProfileRefs(participantIds);
  const allProfileRefs = [...new Set([...allocationProfiles.values(), profileRef])];

  await db.runTransaction(async (transaction) => {
    const [sourceSnap, profileSnap, lockSnap, ...friendSnaps] = await Promise.all([
      transaction.get(sourceRef), transaction.get(profileRef), transaction.get(lockRef),
      ...friendRefs.map((ref) => transaction.get(ref)),
    ]);
    const profileDocs = await Promise.all(allProfileRefs.map((ref) => transaction.get(ref)));
    if (!profileSnap.exists || profileSnap.get("userId") !== uid) fail("permission-denied", "The source profile must belong to the signed-in user.");
    if (!sourceSnap.exists) fail("not-found", "The selected source expense no longer exists.");
    const source = sourceSnap.data();
    const sourcePaise = rupeesToPaise(source.amount);
    if (source.type !== "expense" || source.kind || source.currency !== "INR" || sourcePaise === null
      || typeof source.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(source.date)) {
      fail("failed-precondition", "Choose a valid INR expense transaction.");
    }
    if (participantSum(participants) !== sourcePaise) fail("invalid-argument", "Participant shares must equal the linked expense total.");
    if (splitType === 'equal') {
      try { validateEqualShares(sourcePaise, participants); }
      catch (error) { fail("invalid-argument", error.message); }
    }
    if (friendSnaps.some((friend, index) => !friend.exists
      || friend.get("userId") !== uid
      || friend.get("friendId") !== participantIds.filter((participantId) => participantId !== uid)[index])) {
      fail("permission-denied", "All other allocation participants must be accepted friends.");
    }
    if (lockSnap.exists && lockSnap.get("status") !== "released") fail("already-exists", "This expense is already linked to a split.");
    for (const profileDoc of profileDocs) {
      if (!profileDoc.exists || typeof profileDoc.get("userId") !== "string") fail("failed-precondition", "A participant finance profile is invalid.");
    }
    const verifiedParticipants = participants.map((participant) => {
      const participantProfileRef = defaultProfileForTxn(allocationProfiles, participant.userId);
      const participantProfile = profileDocs.find((profile) => profile.id === participantProfileRef.id);
      if (!participantProfile || participantProfile.get("userId") !== participant.userId) fail("permission-denied", "Participant profile ownership validation failed.");
      return { ...participant, displayName: participantProfile.get("name") || participant.userId };
    });
    const obligations = makeObligations(verifiedParticipants, uid);
    const initialSettled = obligations.length === 0;
    const split = {
      title,
      description: typeof data.description === "string" ? data.description.slice(0, 500) : "",
      createdBy: uid,
      paidByUserId: uid,
      sourceProfileId,
      sourceTransactionId,
      totalAmountInPaise: sourcePaise,
      currency: "INR",
      type: splitType,
      participants: verifiedParticipants,
      participantIds,
      obligations,
      status: initialSettled ? "finalizing" : "pending_settlement",
      finalizationStatus: initialSettled ? "processing" : "not_started",
      sourceDate: source.date,
      sourceCategory: source.category || "Other",
      sourceCategoryId: source.categoryId || source.category_id || null,
      createdAt: timestamp(),
      updatedAt: timestamp(),
    };
    transaction.create(splitRef, split);
    transaction.set(lockRef, { splitId: splitRef.id, sourceProfileId, sourceTransactionId, createdBy: uid, status: "claimed", createdAt: timestamp(), releasedAt: null });
    if (initialSettled) {
      const allocationTransactionIds = {};
      for (const participant of verifiedParticipants) {
        if (participant.shareAmountInPaise === 0) continue;
        const profile = profileDocs.find((item) => item.id === defaultProfileForTxn(allocationProfiles, participant.userId).id);
        if (!profile || profile.get("userId") !== participant.userId) fail("permission-denied", "Allocation profile ownership validation failed.");
        const allocation = makeTransaction({
          profileId: profile.id, userId: participant.userId, type: "expense",
          amountInPaise: participant.shareAmountInPaise, category: "Split Expense", kind: "allocation",
          splitId: splitRef.id, sourceProfileId, sourceTransactionId, sourceCategory: source.category || "Other",
          sourceCategoryId: source.categoryId || source.category_id || null, date: source.date,
        });
        transaction.create(allocation.ref, allocation.data);
        allocationTransactionIds[participant.userId] = allocation.ref.id;
      }
      transaction.update(splitRef, {
        status: "settled", finalizationStatus: "complete", finalizedAt: timestamp(), settledAt: timestamp(),
        allocationProfileIds: Object.fromEntries(participantIds.map((participantId) => [participantId, defaultProfileForTxn(allocationProfiles, participantId).id])),
        allocationTransactionIds,
        updatedAt: timestamp(),
      });
    }
  });
  return { splitId: splitRef.id };
});

exports.requestSplitRepayment = onCall(async (request) => {
  const data = request.data || {};
  const uid = requireAuth(request);
  const splitId = assertDocumentId(data.splitId, "Split ID");
  const profileId = assertDocumentId(data.senderProfileId, "Sender profile");
  const key = assertString(data.idempotencyKey, "Idempotency key");
  if (key.length > 200) fail("invalid-argument", "Idempotency key is too long.");
  const amountInPaise = assertPaise(data.amountInPaise, "Repayment amount");
  const splitRef = db.doc(`splits/${splitId}`);
  const settlementId = stableId(uid, key);
  const settlementRef = splitRef.collection("settlements").doc(settlementId);
  const senderProfileRef = db.doc(profilePath(profileId));
  await db.runTransaction(async (transaction) => {
    const [splitSnap, existingSnap, profileSnap] = await Promise.all([
      transaction.get(splitRef), transaction.get(settlementRef), transaction.get(senderProfileRef),
    ]);
    if (!splitSnap.exists) fail("not-found", "Split not found.");
    const split = splitSnap.data();
    if (split.status === "cancelled" || split.status === "settled" || split.finalizationStatus === "complete") fail("failed-precondition", "This split is no longer accepting repayments.");
    if (!profileSnap.exists || profileSnap.get("userId") !== uid) fail("permission-denied", "The sender profile must belong to you.");
    const index = obligationIndex(split.obligations, uid, split.paidByUserId);
    if (index < 0) fail("permission-denied", "You do not owe a repayment for this split.");
    if (existingSnap.exists) {
      const existing = existingSnap.data();
      if (existing.fromUserId !== uid || existing.amountInPaise !== amountInPaise || existing.senderProfileId !== profileId) fail("already-exists", "Idempotency key was already used for another payment.");
      return;
    }
    const obligation = split.obligations[index];
    const available = obligation.amountInPaise - obligation.acceptedAmountInPaise - obligation.pendingAmountInPaise;
    if (amountInPaise > available) fail("failed-precondition", "Repayment exceeds the remaining unacknowledged obligation.");
    const obligations = split.obligations.map((item, i) => i === index ? { ...item, pendingAmountInPaise: item.pendingAmountInPaise + amountInPaise } : item);
    transaction.create(settlementRef, {
      splitId, fromUserId: uid, toUserId: split.paidByUserId, amountInPaise,
      senderProfileId: profileId, status: "pending", idempotencyKey: key,
      createdAt: timestamp(),
    });
    transaction.update(splitRef, { obligations, updatedAt: timestamp() });
  });
  return { settlementId };
});

exports.acceptSplitRepayment = onCall(async (request) => {
  const data = request.data || {};
  const uid = requireAuth(request);
  const splitId = assertDocumentId(data.splitId, "Split ID");
  const settlementId = assertDocumentId(data.settlementId, "Settlement ID");
  const recipientProfileId = assertDocumentId(data.recipientProfileId, "Recipient profile");
  const splitRef = db.doc(`splits/${splitId}`);
  const settlementRef = splitRef.collection("settlements").doc(settlementId);
  const initialSplit = await splitRef.get();
  if (!initialSplit.exists) fail("not-found", "Split not found.");
  const initial = initialSplit.data();
  if (initial.createdBy !== uid || initial.paidByUserId !== uid) fail("permission-denied", "Only the original payer can accept repayments.");
  const participants = initial.participants || [];
  const profileRefs = await defaultProfileRefs(participants.map((participant) => participant.userId));
  const recipientProfileRef = db.doc(profilePath(recipientProfileId));
  const profileReadRefs = [...new Set([...profileRefs.values(), recipientProfileRef])];
  const senderProfileRefs = new Map();
  const firstSettlement = await settlementRef.get();
  if (!firstSettlement.exists) fail("not-found", "Repayment acknowledgment not found.");
  senderProfileRefs.set(firstSettlement.get("senderProfileId"), db.doc(profilePath(firstSettlement.get("senderProfileId"))));
  const transactionDate = new Date().toISOString().slice(0, 10);
  await db.runTransaction(async (transaction) => {
    const [splitSnap, settlementSnap, ...profileSnaps] = await Promise.all([
      transaction.get(splitRef), transaction.get(settlementRef),
      ...[...profileReadRefs, ...senderProfileRefs.values()].map((ref) => transaction.get(ref)),
    ]);
    if (!splitSnap.exists || !settlementSnap.exists) fail("not-found", "Split or acknowledgment no longer exists.");
    const split = splitSnap.data();
    const settlement = settlementSnap.data();
    if (settlement.status === "accepted") return;
    if (settlement.status !== "pending") fail("failed-precondition", "Only pending acknowledgments can be accepted.");
    if (split.createdBy !== uid || settlement.toUserId !== uid) fail("permission-denied", "Only the creditor can accept this repayment.");
    const recipientDoc = profileSnaps.find((profile) => profile.id === recipientProfileId);
    const senderDoc = profileSnaps.find((profile) => profile.id === settlement.senderProfileId);
    if (!recipientDoc || !recipientDoc.exists || recipientDoc.get("userId") !== uid) fail("permission-denied", "Recipient profile ownership validation failed.");
    if (!senderDoc || !senderDoc.exists || senderDoc.get("userId") !== settlement.fromUserId) fail("permission-denied", "Sender profile ownership validation failed.");
    for (const [participantId, ref] of profileRefs) {
      const profile = profileSnaps.find((item) => item.id === ref.id);
      if (!profile || !profile.exists || profile.get("userId") !== participantId) fail("failed-precondition", "Allocation profile ownership validation failed.");
    }
    const index = obligationIndex(split.obligations, settlement.fromUserId, uid);
    if (index < 0) fail("failed-precondition", "Repayment does not match an outstanding obligation.");
    const obligation = split.obligations[index];
    if (settlement.amountInPaise > obligation.amountInPaise - obligation.acceptedAmountInPaise) fail("failed-precondition", "Repayment exceeds the outstanding obligation.");
    const obligations = split.obligations.map((item, i) => i === index ? {
      ...item,
      acceptedAmountInPaise: item.acceptedAmountInPaise + settlement.amountInPaise,
      pendingAmountInPaise: Math.max(0, item.pendingAmountInPaise - settlement.amountInPaise),
    } : item);
    const finalizing = allObligationsPaid(obligations);
    const recipientTransfer = makeTransaction({
      profileId: recipientProfileId, userId: uid, type: "income", amountInPaise: settlement.amountInPaise,
      category: "Split Income", kind: "repayment", splitId, sourceProfileId: split.sourceProfileId,
      sourceTransactionId: split.sourceTransactionId, settlementId, counterpartyUserId: settlement.fromUserId, date: transactionDate,
    });
    const senderTransfer = makeTransaction({
      profileId: settlement.senderProfileId, userId: settlement.fromUserId, type: "expense", amountInPaise: settlement.amountInPaise,
      category: "Split Expense", kind: "repayment", splitId, sourceProfileId: split.sourceProfileId,
      sourceTransactionId: split.sourceTransactionId, settlementId, counterpartyUserId: uid, date: transactionDate,
    });
    transaction.create(recipientTransfer.ref, recipientTransfer.data);
    transaction.create(senderTransfer.ref, senderTransfer.data);
    transaction.update(settlementRef, {
      status: "accepted", acceptedBy: uid, recipientProfileId,
      senderTransactionId: senderTransfer.ref.id,
      recipientTransactionId: recipientTransfer.ref.id,
      acceptedAt: timestamp(),
    });
    transaction.update(splitRef, {
      obligations,
      status: finalizing ? "finalizing" : splitStatus(obligations),
      finalizationStatus: finalizing ? "processing" : split.finalizationStatus,
      updatedAt: timestamp(),
    });
    if (finalizing) {
      const allocationTransactionIds = {};
      for (const participant of split.participants) {
        if (participant.shareAmountInPaise === 0) continue;
        const profileRef = defaultProfileForTxn(profileRefs, participant.userId);
        const profile = profileSnaps.find((item) => item.id === profileRef.id);
        if (!profile || profile.get("userId") !== participant.userId) fail("permission-denied", "Allocation profile ownership validation failed.");
        const allocation = makeTransaction({
          profileId: profile.id, userId: participant.userId, type: "expense", amountInPaise: participant.shareAmountInPaise,
          category: "Split Expense", kind: "allocation", splitId, sourceProfileId: split.sourceProfileId,
          sourceTransactionId: split.sourceTransactionId, sourceCategory: split.sourceCategory,
          sourceCategoryId: split.sourceCategoryId, date: split.sourceDate,
        });
        transaction.create(allocation.ref, allocation.data);
        allocationTransactionIds[participant.userId] = allocation.ref.id;
      }
      transaction.update(splitRef, {
        status: "settled", finalizationStatus: "complete", settledAt: timestamp(), finalizedAt: timestamp(),
        allocationProfileIds: Object.fromEntries(split.participants.map((participant) => [participant.userId, defaultProfileForTxn(profileRefs, participant.userId).id])),
        allocationTransactionIds,
        updatedAt: timestamp(),
      });
    }
  });
  return { accepted: true };
});

async function closePendingSettlement(data, context, terminalStatus) {
  const uid = requireAuth(context);
  const splitId = assertDocumentId(data.splitId, "Split ID");
  const settlementId = assertDocumentId(data.settlementId, "Settlement ID");
  const splitRef = db.doc(`splits/${splitId}`);
  const settlementRef = splitRef.collection("settlements").doc(settlementId);
  await db.runTransaction(async (transaction) => {
    const [splitSnap, settlementSnap] = await Promise.all([transaction.get(splitRef), transaction.get(settlementRef)]);
    if (!splitSnap.exists || !settlementSnap.exists) fail("not-found", "Split or acknowledgment not found.");
    const split = splitSnap.data();
    const settlement = settlementSnap.data();
    if (settlement.status === terminalStatus) return;
    if (settlement.status !== "pending") fail("failed-precondition", "Only pending acknowledgments can be changed.");
    const authorized = terminalStatus === "cancelled" ? settlement.fromUserId === uid : split.createdBy === uid && settlement.toUserId === uid;
    if (!authorized) fail("permission-denied", "You cannot change this acknowledgment.");
    const index = obligationIndex(split.obligations, settlement.fromUserId, settlement.toUserId);
    if (index < 0) fail("failed-precondition", "Repayment obligation no longer exists.");
    const obligations = split.obligations.map((item, i) => i === index ? { ...item, pendingAmountInPaise: Math.max(0, item.pendingAmountInPaise - settlement.amountInPaise) } : item);
    transaction.update(settlementRef, { status: terminalStatus, [`${terminalStatus}At`]: timestamp(), ...(terminalStatus === "rejected" ? { rejectedBy: uid } : { cancelledBy: uid }) });
    transaction.update(splitRef, { obligations, status: splitStatus(obligations), updatedAt: timestamp() });
  });
}

exports.rejectSplitRepayment = onCall((request) => closePendingSettlement(request.data || {}, request, "rejected").then(() => ({ rejected: true })));
exports.cancelSplitRepayment = onCall((request) => closePendingSettlement(request.data || {}, request, "cancelled").then(() => ({ cancelled: true })));

exports.cancelSharedExpense = onCall(async (request) => {
  const data = request.data || {};
  const uid = requireAuth(request);
  const splitId = assertDocumentId(data.splitId, "Split ID");
  const splitRef = db.doc(`splits/${splitId}`);
  const snapshot = await splitRef.get();
  if (!snapshot.exists) fail("not-found", "Split not found.");
  const split = snapshot.data();
  const lockRef = db.doc(sourceLockPath(split.sourceProfileId, split.sourceTransactionId));
  await db.runTransaction(async (transaction) => {
    const [splitSnap, lockSnap] = await Promise.all([transaction.get(splitRef), transaction.get(lockRef)]);
    if (!splitSnap.exists) fail("not-found", "Split not found.");
    const current = splitSnap.data();
    if (current.createdBy !== uid) fail("permission-denied", "Only the split creator can cancel it.");
    if (current.status === "cancelled") return;
    if (current.finalizationStatus === "complete" || current.obligations.some((item) => item.acceptedAmountInPaise > 0)) {
      fail("failed-precondition", "A split with accepted repayments or final allocations cannot be cancelled.");
    }
    if (current.obligations.some((item) => item.pendingAmountInPaise > 0)) fail("failed-precondition", "Cancel pending repayment acknowledgments before cancelling the split.");
    transaction.update(splitRef, { status: "cancelled", updatedAt: timestamp(), cancelledAt: timestamp() });
    if (lockSnap.exists && lockSnap.get("splitId") === splitId) transaction.update(lockRef, { status: "released", releasedAt: timestamp() });
  });
  return { cancelled: true };
});

exports.onFriendRequestAccepted = onDocumentUpdated("friendRequests/{requestId}", async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();

    // Run only when status becomes "accepted"
    if (before.status !== "accepted" && after.status === "accepted") {
      const { fromUserId, toUserId } = after;

      const db = admin.firestore();

      // Prevent duplicate creation
      const existing = await db
        .doc(`friends/${toUserId}_${fromUserId}`)
        .get();

      if (existing.exists) {
        return null;
      }

      const batch = db.batch();

      // A accepts B → create both sides

      // A → B
      const ref1 = db.doc(`friends/${toUserId}_${fromUserId}`);
      batch.set(ref1, {
        userId: toUserId,
        friendId: fromUserId,
        connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // B → A
      const ref2 = db.doc(`friends/${fromUserId}_${toUserId}`);
      batch.set(ref2, {
        userId: fromUserId,
        friendId: toUserId,
        connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await batch.commit();
    }

    return null;
  });