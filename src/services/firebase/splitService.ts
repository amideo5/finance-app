import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import type {
  SharedExpenseSplit,
  SplitParticipant,
  SplitSettlement,
} from '@/types/finance';
import { auth, db } from '@/src/firebaseConfig';

const SUPABASE_SPLIT_FUNCTION_URL =
  process.env.EXPO_PUBLIC_SUPABASE_SPLIT_FUNCTION_URL;

interface CreateSplitPayload {
  sourceProfileId: string;
  sourceTransactionId: string;
  title: string;
  description?: string;
  type: 'equal' | 'custom';
  participants: SplitParticipant[];
}

async function callSupabaseSplitFunction<TOutput>(
  route: string,
  payload: Record<string, unknown>,
): Promise<TOutput> {
  const user = auth.currentUser;

  if (!user) {
    throw new Error('You must be signed in to perform this action.');
  }

  if (!SUPABASE_SPLIT_FUNCTION_URL) {
    throw new Error('Supabase split function URL is not configured.');
  }

  // Firebase Auth token: Supabase Edge Function verifies this server-side.
  const firebaseIdToken = await user.getIdToken();

  const response = await fetch(
    `${SUPABASE_SPLIT_FUNCTION_URL.replace(/\/$/, '')}/${route}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-firebase-id-token': firebaseIdToken,
      },
      body: JSON.stringify(payload),
    },
  );

  const responseBody = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      responseBody?.error ??
        `Supabase split request failed with status ${response.status}`,
    );
  }

  return responseBody as TOutput;
}

export async function createSplit(payload: CreateSplitPayload): Promise<string> {
  const result = await callSupabaseSplitFunction<{ splitId: string }>(
    'create-shared-expense',
    payload,
  );

  return result.splitId;
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

      if (
        data.currency !== 'INR' ||
        !Array.isArray(data.participants) ||
        !Number.isSafeInteger(data.totalAmountInPaise)
      ) {
        return;
      }

      unique.set(splitDoc.id, { id: splitDoc.id, ...data } as SharedExpenseSplit);
    });
  }

  return [...unique.values()];
}

export async function getSplit(splitId: string): Promise<SharedExpenseSplit | null> {
  const snapshot = await getDoc(doc(db, 'splits', splitId));

  if (!snapshot.exists()) return null;

  const data = snapshot.data();

  if (
    data.currency !== 'INR' ||
    !Array.isArray(data.participants) ||
    !Number.isSafeInteger(data.totalAmountInPaise)
  ) {
    return null;
  }

  return { id: snapshot.id, ...data } as SharedExpenseSplit;
}

export async function getSplitSettlements(splitId: string): Promise<SplitSettlement[]> {
  const snapshot = await getDocs(collection(db, 'splits', splitId, 'settlements'));

  return snapshot.docs.map(
    (settlementDoc) =>
      ({ id: settlementDoc.id, ...settlementDoc.data() }) as SplitSettlement,
  );
}

export async function requestRepayment(input: {
  splitId: string;
  amountInPaise: number;
  senderProfileId: string;
  idempotencyKey: string;
}): Promise<string> {
  const result = await callSupabaseSplitFunction<{ settlementId: string }>(
    'request-split-repayment',
    input,
  );

  return result.settlementId;
}

export async function acceptRepayment(input: {
  splitId: string;
  settlementId: string;
  recipientProfileId: string;
}): Promise<void> {
  await callSupabaseSplitFunction<{ accepted: boolean; finalized?: boolean }>(
    'accept-split-repayment',
    input,
  );
}

export async function rejectRepayment(input: {
  splitId: string;
  settlementId: string;
}): Promise<void> {
  await callSupabaseSplitFunction<{ rejected: boolean }>(
    'reject-split-repayment',
    input,
  );
}

export async function cancelRepayment(input: {
  splitId: string;
  settlementId: string;
}): Promise<void> {
  await callSupabaseSplitFunction<{ cancelled: boolean }>(
    'cancel-split-repayment',
    input,
  );
}

export async function cancelSplit(splitId: string): Promise<void> {
  await callSupabaseSplitFunction<{ cancelled: boolean }>(
    'cancel-shared-expense',
    { splitId },
  );
}