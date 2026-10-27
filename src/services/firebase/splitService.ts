import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import type {
  FriendSettlement,
  SharedExpenseSplit,
  SplitParticipant,
  SplitSettlement,
  UnresolvedFriendObligation,
} from '@/types/finance';
import type { SettlementSuggestion } from '@/src/utils/splitUtils';
import { auth, db } from '@/src/firebaseConfig';

interface CreateSplitPayload {
  sourceProfileId: string;
  sourceTransactionId: string;
  title?: string;
  description?: string;
  type: 'equal' | 'custom';
  participants: SplitParticipant[];
}

const ROUTES = {
  health: '',
  createSplit: 'create-shared-expense',
  cancelSplit: 'cancel-shared-expense',
  getNetworkNetBalances: 'get-network-net-balances',
  requestSplitRepayment: 'request-split-repayment',
  acceptSplitRepayment: 'accept-split-repayment',
  rejectSplitRepayment: 'reject-split-repayment',
  cancelSplitRepayment: 'cancel-split-repayment',
  requestFriendSettlement: 'request-friend-settlement',
  acceptFriendSettlement: 'accept-friend-settlement',
  rejectFriendSettlement: 'reject-friend-settlement',
  cancelFriendSettlement: 'cancel-friend-settlement',
} as const;

type RouteName = keyof typeof ROUTES;

function getFunctionBaseUrl(): string {
  const url = process.env.EXPO_PUBLIC_SUPABASE_SPLIT_FUNCTION_URL?.trim().replace(/\/+$/, '');
  if (!url) {
    throw new Error(
      'Missing EXPO_PUBLIC_SUPABASE_SPLIT_FUNCTION_URL. Set it to your Supabase split-health function URL and restart Expo.',
    );
  }
  return url;
}

async function callSupabaseSplitFunction<TInput extends object, TOutput>(
  route: RouteName,
  payload: TInput,
): Promise<TOutput> {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to perform a settlement.');
  const idToken = await user.getIdToken();
  const baseUrl = getFunctionBaseUrl();
  const routePath = ROUTES[route];
  const url = routePath ? `${baseUrl}/${routePath}` : baseUrl;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-firebase-id-token': idToken,
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: route === 'health' ? 'GET' : 'POST',
      headers,
      ...(route === 'health' ? {} : { body: JSON.stringify(payload) }),
    });
  } catch (error) {
    throw new Error(`Could not reach Supabase Edge Function (${error instanceof Error ? error.message : 'network error'}).`);
  }

  const responseText = await response.text();
  let data: Record<string, unknown> = {};
  if (responseText) {
    try {
      data = JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      throw new Error(`Supabase returned an invalid response (HTTP ${response.status}).`);
    }
  }
  if (!response.ok) {
    const message = typeof data.error === 'string' ? data.error : `Supabase request failed (HTTP ${response.status}).`;
    throw new Error(message);
  }
  return data as TOutput;
}

export async function checkSplitFunctionHealth(): Promise<{
  authenticated: boolean;
  uid: string;
  firestore: string;
  profileExists: boolean;
}> {
  return callSupabaseSplitFunction<Record<string, never>, {
    authenticated: boolean; uid: string; firestore: string; profileExists: boolean;
  }>('health', {});
}

export async function createSplit(payload: CreateSplitPayload): Promise<string> {
  const result = await callSupabaseSplitFunction<CreateSplitPayload, { splitId: string }>('createSplit', payload);
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

export async function getFriendSettlements(userId: string): Promise<FriendSettlement[]> {
  const snapshot = await getDocs(
    query(collection(db, 'friendSettlements'), where('participantIds', 'array-contains', userId)),
  );
  return snapshot.docs.map((settlementDoc) => ({ id: settlementDoc.id, ...settlementDoc.data() } as FriendSettlement));
}

export async function getFriendNetBalances(userId: string): Promise<{
  balances: Record<string, number>;
  suggestions: SettlementSuggestion[];
  unresolvedObligations: UnresolvedFriendObligation[];
  algorithmVersion: number;
}> {
  const result = await callSupabaseSplitFunction<Record<string, never>, {
    balances: Record<string, number>;
    suggestions: SettlementSuggestion[];
    unresolvedObligations: UnresolvedFriendObligation[];
    algorithmVersion: number;
  }>('getNetworkNetBalances', {});
  if (
    !result.balances
    || typeof result.balances[userId] !== 'number'
    || !Array.isArray(result.suggestions)
    || !Array.isArray(result.unresolvedObligations)
    || result.algorithmVersion !== 3
  ) {
    throw new Error('The split service is outdated or returned incomplete settlement data. Deploy the updated supabase/functions/split-health Edge Function (algorithm version 3) before using friend settlement suggestions.');
  }
  return result;
}

export async function requestRepayment(input: {
  splitId: string;
  amountInPaise: number;
  senderProfileId: string;
  idempotencyKey: string;
}): Promise<string> {
  const result = await callSupabaseSplitFunction<typeof input, { settlementId: string }>('requestSplitRepayment', input);
  return result.settlementId;
}

export async function acceptRepayment(input: {
  splitId: string;
  settlementId: string;
  recipientProfileId: string;
}): Promise<void> {
  await callSupabaseSplitFunction<typeof input, { accepted: boolean }>('acceptSplitRepayment', input);
}

export async function rejectRepayment(input: { splitId: string; settlementId: string }): Promise<void> {
  await callSupabaseSplitFunction<typeof input, { rejected: boolean }>('rejectSplitRepayment', input);
}

export async function cancelRepayment(input: { splitId: string; settlementId: string }): Promise<void> {
  await callSupabaseSplitFunction<typeof input, { cancelled: boolean }>('cancelSplitRepayment', input);
}

export async function cancelSplit(splitId: string): Promise<void> {
  await callSupabaseSplitFunction<{ splitId: string }, { cancelled: boolean }>('cancelSplit', { splitId });
}

export async function requestFriendSettlement(input: {
  toUserId: string;
  amountInPaise: number;
  idempotencyKey: string;
  fromProfileId: string;
  fromAccountId: string;
  note?: string;
}): Promise<string> {
  const result = await callSupabaseSplitFunction<typeof input, { settlementId: string }>('requestFriendSettlement', input);
  return result.settlementId;
}

export async function acceptFriendSettlement(input: {
  settlementId: string;
  recipientProfileId: string;
  recipientAccountId: string;
}): Promise<void> {
  await callSupabaseSplitFunction<typeof input, { accepted: boolean }>('acceptFriendSettlement', input);
}

export async function rejectFriendSettlement(input: { settlementId: string }): Promise<void> {
  await callSupabaseSplitFunction<typeof input, { rejected: boolean }>('rejectFriendSettlement', input);
}

export async function cancelFriendSettlement(input: { settlementId: string }): Promise<void> {
  await callSupabaseSplitFunction<typeof input, { cancelled: boolean }>('cancelFriendSettlement', input);
}
