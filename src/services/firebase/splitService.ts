import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { SharedExpenseSplit, SplitParticipant, SplitSettlement } from '@/types/finance';
import { db, functions } from '@/src/firebaseConfig';

interface CreateSplitPayload {
  sourceProfileId: string;
  sourceTransactionId: string;
  title: string;
  description?: string;
  type: 'equal' | 'custom';
  participants: SplitParticipant[];
}

const callable = <TInput, TOutput>(name: string) => httpsCallable<TInput, TOutput>(functions, name);

export async function createSplit(payload: CreateSplitPayload): Promise<string> {
  const result = await callable<CreateSplitPayload, { splitId: string }>('createSharedExpense')(payload);
  return result.data.splitId;
}

export async function getUserSplits(userId: string): Promise<SharedExpenseSplit[]> {
  const [participantSnapshot, creatorSnapshot] = await Promise.all([
    getDocs(query(collection(db, 'splits'), where('participantIds', 'array-contains', userId))),
    getDocs(query(collection(db, 'splits'), where('createdBy', '==', userId))),
  ]);
  const unique = new Map<string, SharedExpenseSplit>();
  for (const snapshot of [participantSnapshot, creatorSnapshot]) {
    snapshot.docs.forEach((splitDoc) => {
      const data = splitDoc.data();
      if (data.currency !== 'INR' || !Array.isArray(data.participants) || !Number.isSafeInteger(data.totalAmountInPaise)) return;
      unique.set(splitDoc.id, { id: splitDoc.id, ...data } as SharedExpenseSplit);
    });
  }
  return [...unique.values()];
}

export async function getSplit(splitId: string): Promise<SharedExpenseSplit | null> {
  const snapshot = await getDoc(doc(db, 'splits', splitId));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (data.currency !== 'INR' || !Array.isArray(data.participants) || !Number.isSafeInteger(data.totalAmountInPaise)) return null;
  return { id: snapshot.id, ...data } as SharedExpenseSplit;
}

export async function getSplitSettlements(splitId: string): Promise<SplitSettlement[]> {
  const snapshot = await getDocs(collection(db, 'splits', splitId, 'settlements'));
  return snapshot.docs.map((settlementDoc) => ({ id: settlementDoc.id, ...settlementDoc.data() } as SplitSettlement));
}

export async function requestRepayment(input: {
  splitId: string;
  amountInPaise: number;
  senderProfileId: string;
  idempotencyKey: string;
}): Promise<string> {
  const result = await callable<typeof input, { settlementId: string }>('requestSplitRepayment')(input);
  return result.data.settlementId;
}

export async function acceptRepayment(input: { splitId: string; settlementId: string; recipientProfileId: string }): Promise<void> {
  await callable<typeof input, { accepted: boolean }>('acceptSplitRepayment')(input);
}

export async function rejectRepayment(input: { splitId: string; settlementId: string }): Promise<void> {
  await callable<typeof input, { rejected: boolean }>('rejectSplitRepayment')(input);
}

export async function cancelRepayment(input: { splitId: string; settlementId: string }): Promise<void> {
  await callable<typeof input, { cancelled: boolean }>('cancelSplitRepayment')(input);
}

export async function cancelSplit(splitId: string): Promise<void> {
  await callable<{ splitId: string }, { cancelled: boolean }>('cancelSharedExpense')({ splitId });
}
