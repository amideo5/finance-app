import {
    collection,
    deleteDoc,
    doc,
    endAt,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    startAt,
    updateDoc,
    where,
    writeBatch,
} from "firebase/firestore";
import { db } from "../../firebaseConfig";

export const createProfile = async (userId, name, type = "personal") => {
  const profileRef = doc(collection(db, "profiles"));

  await setDoc(profileRef, {
    userId,
    name,
    nameLower: name.trim().toLowerCase(),
    type,
    emoji: "💰",
    currency: "INR",
    isDefault: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Add owner to members
  const memberRef = doc(db, "profiles", profileRef.id, "members", userId);
  await setDoc(memberRef, {
    role: "owner",
    invitedBy: userId,
    createdAt: serverTimestamp(),
  });

  return profileRef.id;
};

export const searchProfilesByName = async (searchText) => {
  const prefix = searchText.trim().toLowerCase();
  if (prefix.length < 2) return [];

  const snapshot = await getDocs(query(
    collection(db, "profiles"),
    orderBy("nameLower"),
    startAt(prefix),
    endAt(`${prefix}\uf8ff`),
    limit(20)
  ));
  return snapshot.docs.map((profileDoc) => ({
    id: profileDoc.id,
    ...profileDoc.data(),
  }));
};


const deleteInChunks = async (refs) => {
  for (let offset = 0; offset < refs.length; offset += 450) {
    const batch = writeBatch(db);
    refs.slice(offset, offset + 450).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
};

/**
 * Delete a finance profile and its nested data. This is intentionally a
 * guarded cascade: global split/settlement records and paired investment
 * transfers cannot be cascaded from the client without breaking audit history.
 */
export const deleteProfileData = async (profileId, userId) => {
  if (!profileId || !userId) throw new Error("A signed-in user and profile are required.");
  const profileRef = doc(db, "profiles", profileId);
  const profileSnapshot = await getDoc(profileRef);
  if (!profileSnapshot.exists()) return true;
  if (profileSnapshot.data().userId !== userId) throw new Error("You can only delete a profile that you own.");

  const [accounts, transactions, budgets, goals, investments, investmentSnapshots, netWorthSnapshots, members] = await Promise.all([
    getDocs(collection(db, "profiles", profileId, "accounts")),
    getDocs(collection(db, "profiles", profileId, "transactions")),
    getDocs(collection(db, "profiles", profileId, "budgets")),
    getDocs(collection(db, "profiles", profileId, "goals")),
    getDocs(collection(db, "profiles", profileId, "investments")),
    getDocs(collection(db, "profiles", profileId, "investmentSnapshots")),
    getDocs(collection(db, "profiles", profileId, "netWorthSnapshots")),
    getDocs(collection(db, "profiles", profileId, "members")),
  ]);

  const specialTransactions = transactions.docs.filter((item) => {
    const data = item.data();
    return Boolean(data.kind || data.splitId || data.settlementId || data.friendSettlementId || data.investmentTransferId || data.investmentLedgerEntryId || data.investmentId || data.serverGenerated);
  });
  if (specialTransactions.length) {
    throw new Error("This profile contains split, settlement, or investment-transfer transactions. Resolve those linked records first; the app will not delete only part of a paired financial history.");
  }

  const investmentLedgerRefs = [];
  for (const investmentDoc of investments.docs) {
    const ledger = await getDocs(collection(db, "profiles", profileId, "investments", investmentDoc.id, "transactions"));
    if (ledger.docs.some((item) => item.data().type === "bank_transfer")) {
      throw new Error(`The ${investmentDoc.data().name || "investment"} has bank-linked ledger entries. Transfer or close it through its investment workflow before deleting this profile.`);
    }
    investmentLedgerRefs.push(...ledger.docs.map((item) => item.ref));
  }

  // Firestore rules protect source transactions that are still referenced by
  // shared splits. Inspect the user's split graph before attempting a cascade.
  const [participantSplits, createdSplits, friendSettlements] = await Promise.all([
    getDocs(query(collection(db, "splits"), where("participantIds", "array-contains", userId))),
    getDocs(query(collection(db, "splits"), where("createdBy", "==", userId))),
    getDocs(query(collection(db, "friendSettlements"), where("participantIds", "array-contains", userId))),
  ]);
  const splitRecords = new Map();
  [...participantSplits.docs, ...createdSplits.docs].forEach((item) => splitRecords.set(item.id, item.data()));
  const linkedSplit = [...splitRecords.values()].some((split) =>
    split.sourceProfileId === profileId || Object.values(split.allocationProfileIds || {}).includes(profileId)
  );
  const linkedFriendSettlement = friendSettlements.docs.some((item) => {
    const data = item.data();
    return [data.senderProfileId, data.recipientProfileId, data.fromProfileId, data.toProfileId].includes(profileId);
  });
  if (linkedSplit || linkedFriendSettlement) {
    throw new Error("This profile is referenced by shared expenses or friend settlements. Keep it available so those shared records remain auditable.");
  }

  await deleteInChunks(investmentLedgerRefs);
  const childRefs = [
    ...accounts.docs.map((item) => item.ref),
    ...transactions.docs.map((item) => item.ref),
    ...budgets.docs.map((item) => item.ref),
    ...goals.docs.map((item) => item.ref),
    ...investments.docs.map((item) => item.ref),
    ...investmentSnapshots.docs.map((item) => item.ref),
    ...netWorthSnapshots.docs.map((item) => item.ref),
    ...members.docs.map((item) => item.ref),
  ];
  await deleteInChunks(childRefs);
  await deleteDoc(profileRef);
  return true;
};
