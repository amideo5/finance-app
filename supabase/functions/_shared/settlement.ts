/**
 * Deterministic settlement helpers shared by the Supabase Edge Function and tests.
 *
 * Settlement policy:
 * - A direct transfer always requires a currently mutual accepted-friend edge.
 * - Within a complete friendship block (a complete vertex-biconnected component),
 *   debts can be netted at group level. Every debtor can pay every creditor directly
 *   because all pairs in that block are direct friends.
 * - Bridge relationships (including a friend connected only through Aryan) stay
 *   bilateral. A chain or ordinary connected component is not treated as a clique.
 * - Group-net transfers change only the global friend-settlement ledger; they do
 *   not rewrite or mark original split obligations as paid.
 */
export type FriendshipRecord = {
  userId?: unknown;
  friendId?: unknown;
  /** Optional Firestore document ID; when present it must match the stored direction. */
  documentId?: unknown;
};

export type LedgerObligation = {
  fromUserId: string;
  toUserId: string;
  amountInPaise: number;
  acceptedAmountInPaise?: number;
  pendingAmountInPaise?: number;
  splitStatus?: string;
};

export type LedgerFriendSettlement = {
  id?: string;
  fromUserId: string;
  toUserId: string;
  amountInPaise: number;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | string;
  idempotencyKey?: string;
  /** Present on newly-created payments that settle balances inside a clique. */
  settlementMode?: 'clique_net' | 'bilateral' | string;
  /** Snapshot of the clique used for authorization; protects against stale requests. */
  settlementGroupUserIds?: string[];
};

export type SafeSettlementSuggestion = {
  fromUserId: string;
  toUserId: string;
  amountInPaise: number;
  settlementMode?: 'clique_net';
};

export type UnresolvedFriendObligation = SafeSettlementSuggestion & {
  reason: 'not_currently_mutual_friends';
};

export type FriendshipAwarePlan = {
  suggestions: SafeSettlementSuggestion[];
  unresolvedObligations: UnresolvedFriendObligation[];
};

export type CliqueBalanceState = {
  groupUserIds: string[];
  /** Balances after completed split repayments and completed friend settlements. */
  actualBalances: Record<string, number>;
  /** Balances after reserving pending payments, used only to avoid duplicate suggestions. */
  availableBalances: Record<string, number>;
};

type PairState = {
  first: string;
  second: string;
  /** Positive means `first` owes `second`; negative means `second` owes `first`. */
  signed: number;
  pendingFirstToSecond: number;
  pendingSecondToFirst: number;
};

export function canonicalFriendshipKey(userA: string, userB: string): string {
  const [first, second] = [userA, userB].sort(compareIds);
  return `${first}\u0000${second}`;
}

/** The app writes a directional `friends` record for each side when accepted. */
export function buildMutualFriendshipKeys(records: FriendshipRecord[]): Set<string> {
  const directed = new Set<string>();
  for (const record of records) {
    const userId = typeof record.userId === 'string' ? record.userId : '';
    const friendId = typeof record.friendId === 'string' ? record.friendId : '';
    const documentId = typeof record.documentId === 'string' ? record.documentId : '';
    if (!userId || !friendId || userId === friendId) continue;
    if (documentId && documentId !== `${userId}_${friendId}`) continue;
    directed.add(`${userId}\u0000${friendId}`);
  }

  const mutual = new Set<string>();
  for (const directedKey of directed) {
    const separator = directedKey.indexOf('\u0000');
    const userId = directedKey.slice(0, separator);
    const friendId = directedKey.slice(separator + 1);
    if (directed.has(`${friendId}\u0000${userId}`)) mutual.add(canonicalFriendshipKey(userId, friendId));
  }
  return mutual;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function requirePaise(value: unknown, label: string, allowZero = true): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${label} must be a valid whole-paise amount`);
  }
  return value;
}

function addSafeInteger(current: number, delta: number, label: string): number {
  const next = current + delta;
  if (!Number.isSafeInteger(next)) throw new Error(`${label} exceeds the safe whole-paise range`);
  return next;
}

function adjustBalance(balances: Record<string, number>, userId: string, delta: number, label: string): void {
  balances[userId] = addSafeInteger(balances[userId] ?? 0, delta, label);
}

function pairFor(map: Map<string, PairState>, userA: string, userB: string): PairState {
  if (!userA || !userB || userA === userB) throw new Error('A settlement cannot involve the same or a missing user twice');
  const [first, second] = [userA, userB].sort(compareIds);
  const key = `${first}\u0000${second}`;
  let pair = map.get(key);
  if (!pair) {
    pair = { first, second, signed: 0, pendingFirstToSecond: 0, pendingSecondToFirst: 0 };
    map.set(key, pair);
  }
  return pair;
}

function edgeFromKey(key: string): [string, string] {
  const separator = key.indexOf('\u0000');
  return [key.slice(0, separator), key.slice(separator + 1)];
}

/**
 * Finds complete vertex-biconnected friendship blocks. This deliberately excludes
 * bridges such as Aryan–Ishita and Aryan–Gol Kong from group netting. Merely being
 * in one connected component (A–B–C) is not enough.
 */
export function getCompleteFriendshipCliques(mutualFriendshipKeys: Set<string>): string[][] {
  const adjacency = new Map<string, Set<string>>();
  for (const key of mutualFriendshipKeys) {
    const [a, b] = edgeFromKey(key);
    if (!a || !b || a === b) continue;
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  }

  const discovery = new Map<string, number>();
  const low = new Map<string, number>();
  const edgeStack: string[] = [];
  const blocks: string[][] = [];
  let clock = 0;

  const dfs = (user: string, parentEdge: string | null) => {
    clock++;
    discovery.set(user, clock);
    low.set(user, clock);
    const neighbors = [...(adjacency.get(user) ?? [])].sort(compareIds);
    for (const neighbor of neighbors) {
      const edgeKey = canonicalFriendshipKey(user, neighbor);
      if (!discovery.has(neighbor)) {
        edgeStack.push(edgeKey);
        dfs(neighbor, edgeKey);
        low.set(user, Math.min(low.get(user)!, low.get(neighbor)!));
        if (low.get(neighbor)! >= discovery.get(user)!) {
          const blockEdges: string[] = [];
          while (edgeStack.length) {
            const popped = edgeStack.pop()!;
            blockEdges.push(popped);
            if (popped === edgeKey) break;
          }
          blocks.push(blockEdges);
        }
      } else if (edgeKey !== parentEdge && discovery.get(neighbor)! < discovery.get(user)!) {
        edgeStack.push(edgeKey);
        low.set(user, Math.min(low.get(user)!, discovery.get(neighbor)!));
      }
    }
  };

  for (const user of [...adjacency.keys()].sort(compareIds)) {
    if (!discovery.has(user)) dfs(user, null);
  }

  const cliques: string[][] = [];
  for (const blockEdges of blocks) {
    const vertices = new Set<string>();
    for (const edge of blockEdges) {
      const [a, b] = edgeFromKey(edge);
      vertices.add(a);
      vertices.add(b);
    }
    if (vertices.size < 3) continue;
    const users = [...vertices].sort(compareIds);
    let complete = true;
    for (let i = 0; i < users.length && complete; i++) {
      for (let j = i + 1; j < users.length; j++) {
        if (!mutualFriendshipKeys.has(canonicalFriendshipKey(users[i], users[j]))) {
          complete = false;
          break;
        }
      }
    }
    if (complete) cliques.push(users);
  }
  return cliques.sort((a, b) => compareIds(a[0] ?? '', b[0] ?? '') || a.length - b.length);
}

export function getCompleteFriendshipCliqueForPair(
  mutualFriendshipKeys: Set<string>,
  userA: string,
  userB: string,
): string[] | null {
  if (!mutualFriendshipKeys.has(canonicalFriendshipKey(userA, userB))) return null;
  return getCompleteFriendshipCliques(mutualFriendshipKeys).find((group) => group.includes(userA) && group.includes(userB)) ?? null;
}

export function deduplicateFriendSettlementRecords(records: LedgerFriendSettlement[]): LedgerFriendSettlement[] {
  const unique = new Map<string, LedgerFriendSettlement>();
  records.forEach((record, index) => {
    if (record.status !== 'accepted' && record.status !== 'pending') return;
    const amount = requirePaise(record.amountInPaise, 'Friend settlement amount', false);
    if (!record.fromUserId || !record.toUserId || record.fromUserId === record.toUserId) {
      throw new Error('Friend settlement has invalid participants');
    }
    const key = record.idempotencyKey?.trim() || record.id || `row-${index}`;
    const previous = unique.get(key);
    if (!previous) {
      unique.set(key, { ...record, amountInPaise: amount });
      return;
    }
    if (
      previous.fromUserId !== record.fromUserId
      || previous.toUserId !== record.toUserId
      || previous.amountInPaise !== amount
    ) {
      throw new Error('Duplicate settlement idempotency keys contain conflicting financial data');
    }
    if (record.status === 'accepted') unique.set(key, { ...record, amountInPaise: amount });
  });
  return [...unique.values()];
}

function validateObligation(obligation: LedgerObligation) {
  const amount = requirePaise(obligation.amountInPaise, 'Split obligation amount');
  const accepted = requirePaise(obligation.acceptedAmountInPaise ?? 0, 'Accepted split amount');
  const pending = requirePaise(obligation.pendingAmountInPaise ?? 0, 'Pending split amount');
  if (accepted > amount || pending > amount - accepted) throw new Error('Accepted and pending repayments exceed a split obligation');
  if (obligation.splitStatus === 'cancelled') {
    if (accepted > 0 || pending > 0) throw new Error('Cancelled split retains accepted or pending repayment amounts');
    return { amount, accepted, pending, cancelled: true };
  }
  if (obligation.splitStatus === 'settled' && (accepted !== amount || pending !== 0)) {
    throw new Error('Settled split status conflicts with outstanding obligation amounts');
  }
  return { amount, accepted, pending, cancelled: false };
}

/** Calculate completed and pending-reserved balances inside one eligible clique. */
export function calculateCliqueBalanceState(
  obligations: LedgerObligation[],
  friendSettlements: LedgerFriendSettlement[],
  groupUserIds: string[],
  options: { excludePendingSettlementId?: string } = {},
): CliqueBalanceState {
  const members = new Set(groupUserIds);
  const group = [...members].sort(compareIds);
  if (group.length < 3) throw new Error('Clique netting requires at least three users');
  const actualBalances: Record<string, number> = Object.fromEntries(group.map((id) => [id, 0]));
  const availableBalances: Record<string, number> = Object.fromEntries(group.map((id) => [id, 0]));
  const pendingTransfers: Array<{ from: string; to: string; amount: number }> = [];

  for (const obligation of obligations) {
    if (!members.has(obligation.fromUserId) || !members.has(obligation.toUserId)) continue;
    if (obligation.fromUserId === obligation.toUserId) throw new Error('A split obligation cannot be a self-transfer');
    const { amount, accepted, pending, cancelled } = validateObligation(obligation);
    if (cancelled) continue;
    const outstanding = amount - accepted;
    adjustBalance(actualBalances, obligation.fromUserId, -outstanding, 'Clique balance');
    adjustBalance(actualBalances, obligation.toUserId, outstanding, 'Clique balance');
    if (pending > 0) pendingTransfers.push({ from: obligation.fromUserId, to: obligation.toUserId, amount: pending });
  }

  const settlements = deduplicateFriendSettlementRecords(friendSettlements);
  for (const settlement of settlements) {
    if (!members.has(settlement.fromUserId) || !members.has(settlement.toUserId)) continue;
    if (settlement.status === 'accepted') {
      adjustBalance(actualBalances, settlement.fromUserId, settlement.amountInPaise, 'Clique balance');
      adjustBalance(actualBalances, settlement.toUserId, -settlement.amountInPaise, 'Clique balance');
    } else if (
      settlement.status === 'pending'
      && settlement.id !== options.excludePendingSettlementId
    ) {
      pendingTransfers.push({ from: settlement.fromUserId, to: settlement.toUserId, amount: settlement.amountInPaise });
    }
  }

  for (const [userId, balance] of Object.entries(actualBalances)) availableBalances[userId] = balance;
  // Reserve pending payments as if they complete for suggestion purposes only.
  // The real ledger is untouched and the UI continues to label them as pending.
  for (const pending of pendingTransfers) {
    adjustBalance(availableBalances, pending.from, pending.amount, 'Clique pending reservation');
    adjustBalance(availableBalances, pending.to, -pending.amount, 'Clique pending reservation');
  }

  const actualTotal = Object.values(actualBalances).reduce((sum, amount) => addSafeInteger(sum, amount, 'Clique balance total'), 0);
  const availableTotal = Object.values(availableBalances).reduce((sum, amount) => addSafeInteger(sum, amount, 'Clique available balance total'), 0);
  if (actualTotal !== 0 || availableTotal !== 0) throw new Error('Clique balances do not reconcile to zero');

  return { groupUserIds: group, actualBalances, availableBalances };
}

/**
 * Returns aggregate settlement capacity for an edge in a complete friendship
 * block, or null if that edge must continue using bilateral settlement semantics.
 */
export function getCliqueSettlementCapacity(
  obligations: LedgerObligation[],
  friendSettlements: LedgerFriendSettlement[],
  mutualFriendshipKeys: Set<string>,
  fromUserId: string,
  toUserId: string,
  options: { excludePendingSettlementId?: string } = {},
): { amountInPaise: number; groupUserIds: string[] } | null {
  const group = getCompleteFriendshipCliqueForPair(mutualFriendshipKeys, fromUserId, toUserId);
  if (!group) return null;
  const state = calculateCliqueBalanceState(obligations, friendSettlements, group, options);
  const debtorCapacity = Math.max(0, -(state.availableBalances[fromUserId] ?? 0));
  const creditorCapacity = Math.max(0, state.availableBalances[toUserId] ?? 0);
  return { amountInPaise: Math.min(debtorCapacity, creditorCapacity), groupUserIds: group };
}

/**
 * Exact minimum-transfer search is practical for the small groups the app targets.
 * Larger cliques use the deterministic debtor/creditor matcher to bound runtime.
 */
function simplifyCompleteCliqueBalances(balances: Record<string, number>): SafeSettlementSuggestion[] {
  const values = Object.entries(balances).sort(([a], [b]) => compareIds(a, b));
  if (values.some(([, amount]) => !Number.isSafeInteger(amount))) throw new Error('Clique balances must be whole paise amounts');
  const sum = values.reduce((total, [, amount]) => addSafeInteger(total, amount, 'Clique balance total'), 0);
  if (sum !== 0) throw new Error(`Clique balances do not reconcile to zero (${sum} paise)`);
  const nonZero = values.filter(([, amount]) => amount !== 0);
  if (nonZero.length <= 1) return [];

  // For groups up to ten non-zero members, search all debtor/creditor pairings
  // that settle at least one endpoint per transfer. This is exact and memoized.
  // Deterministic ID ordering resolves ties between equally short plans.
  const exactLimit = 10;
  if (nonZero.length <= exactLimit) {
    const users = nonZero.map(([userId]) => userId);
    const initial = nonZero.map(([, amount]) => amount);
    const memo = new Map<string, SafeSettlementSuggestion[]>();
    const solve = (state: number[]): SafeSettlementSuggestion[] => {
      const key = state.join(',');
      const cached = memo.get(key);
      if (cached) return cached;
      let debtorIndex = -1;
      for (let i = 0; i < state.length; i++) {
        if (state[i] < 0) { debtorIndex = i; break; }
      }
      if (debtorIndex < 0) return [];

      let best: SafeSettlementSuggestion[] | undefined;
      const debtorAmount = -state[debtorIndex];
      for (let creditorIndex = 0; creditorIndex < state.length; creditorIndex++) {
        if (state[creditorIndex] <= 0) continue;
        const amountInPaise = Math.min(debtorAmount, state[creditorIndex]);
        const next = state.slice();
        next[debtorIndex] += amountInPaise;
        next[creditorIndex] -= amountInPaise;
        const tail = solve(next);
        if (best === undefined || tail.length + 1 < best.length) {
          best = [{
            fromUserId: users[debtorIndex],
            toUserId: users[creditorIndex],
            amountInPaise,
            settlementMode: 'clique_net',
          }, ...tail];
        }
      }
      if (best === undefined) throw new Error('Clique balances could not be reconciled');
      memo.set(key, best);
      return best;
    };
    return solve(initial);
  }

  // Bounded-cost deterministic fallback for larger groups. This remains valid
  // and uses only direct edges, but is not guaranteed to reach the global minimum.
  const debtors = nonZero.filter(([, amount]) => amount < 0).map(([userId, amount]) => ({ userId, remaining: -amount }));
  const creditors = nonZero.filter(([, amount]) => amount > 0).map(([userId, amount]) => ({ userId, remaining: amount }));
  const result: SafeSettlementSuggestion[] = [];
  let debtor = 0;
  let creditor = 0;
  while (debtor < debtors.length && creditor < creditors.length) {
    const from = debtors[debtor];
    const to = creditors[creditor];
    const amountInPaise = Math.min(from.remaining, to.remaining);
    if (amountInPaise > 0) result.push({ fromUserId: from.userId, toUserId: to.userId, amountInPaise, settlementMode: 'clique_net' });
    from.remaining -= amountInPaise;
    to.remaining -= amountInPaise;
    if (from.remaining === 0) debtor++;
    if (to.remaining === 0) creditor++;
  }
  if (debtor !== debtors.length || creditor !== creditors.length) throw new Error('Clique balances could not be reconciled');
  return result;
}

/**
 * Computes net settlements. Complete friendship blocks are simplified as a group;
 * bridge edges and non-friend obligations retain their bilateral meaning.
 */
export function calculateFriendshipAwarePlan(
  obligations: LedgerObligation[],
  friendSettlements: LedgerFriendSettlement[],
  mutualFriendshipKeys: Set<string>,
  options: { focusUserId?: string; excludePendingSettlementId?: string } = {},
): FriendshipAwarePlan {
  const allSettlements = deduplicateFriendSettlementRecords(friendSettlements);
  const cliques = getCompleteFriendshipCliques(mutualFriendshipKeys);
  const cliqueByEdge = new Map<string, string[]>();
  for (const group of cliques) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        cliqueByEdge.set(canonicalFriendshipKey(group[i], group[j]), group);
      }
    }
  }

  // A previously accepted group-net settlement is tied to the clique snapshot it
  // was authorized against. If that clique no longer exists, fail closed instead
  // of silently reinterpreting a group-level transfer as a bilateral payment.
  for (const settlement of allSettlements) {
    if (settlement.settlementMode !== 'clique_net' || settlement.status !== 'accepted' || !settlement.settlementGroupUserIds?.length) continue;
    const snapshot = [...new Set(settlement.settlementGroupUserIds)].sort(compareIds);
    const exists = cliques.some((group) => group.length === snapshot.length && group.every((id, index) => id === snapshot[index]));
    if (!exists) throw new Error('A friendship group changed after a group-net settlement. Suggestions are paused to protect settlement history; review the group settlement before continuing.');
  }
  // A stale pending group-net request has not moved money and can no longer be
  // accepted under its old friendship snapshot. It must not reserve new capacity.
  const settlements = allSettlements.filter((settlement) => {
    if (settlement.id === options.excludePendingSettlementId) return false;
    if (settlement.status !== 'pending' || settlement.settlementMode !== 'clique_net') return true;
    const snapshot = [...new Set(settlement.settlementGroupUserIds ?? [])].sort(compareIds);
    return cliques.some((group) => group.length === snapshot.length && group.every((id, index) => id === snapshot[index]));
  });

  const suggestions: SafeSettlementSuggestion[] = [];
  for (const group of cliques) {
    const state = calculateCliqueBalanceState(obligations, settlements, group, {
      excludePendingSettlementId: options.excludePendingSettlementId,
    });
    suggestions.push(...simplifyCompleteCliqueBalances(state.availableBalances));
  }

  const pairs = new Map<string, PairState>();
  for (const obligation of obligations) {
    const { fromUserId, toUserId } = obligation;
    if (cliqueByEdge.has(canonicalFriendshipKey(fromUserId, toUserId))) continue;
    const { amount, accepted, pending, cancelled } = validateObligation(obligation);
    if (cancelled) continue;
    const pair = pairFor(pairs, fromUserId, toUserId);
    const fromIsFirst = fromUserId === pair.first;
    pair.signed = addSafeInteger(pair.signed, fromIsFirst ? amount - accepted : -(amount - accepted), 'Bilateral balance');
    if (pending > 0) {
      if (fromIsFirst) pair.pendingFirstToSecond = addSafeInteger(pair.pendingFirstToSecond, pending, 'Pending payment total');
      else pair.pendingSecondToFirst = addSafeInteger(pair.pendingSecondToFirst, pending, 'Pending payment total');
    }
  }

  for (const settlement of settlements) {
    if (cliqueByEdge.has(canonicalFriendshipKey(settlement.fromUserId, settlement.toUserId))) continue;
    const pair = pairFor(pairs, settlement.fromUserId, settlement.toUserId);
    const fromIsFirst = settlement.fromUserId === pair.first;
    if (settlement.status === 'accepted') {
      pair.signed = addSafeInteger(pair.signed, fromIsFirst ? -settlement.amountInPaise : settlement.amountInPaise, 'Bilateral balance');
    } else if (settlement.status === 'pending') {
      if (fromIsFirst) pair.pendingFirstToSecond = addSafeInteger(pair.pendingFirstToSecond, settlement.amountInPaise, 'Pending payment total');
      else pair.pendingSecondToFirst = addSafeInteger(pair.pendingSecondToFirst, settlement.amountInPaise, 'Pending payment total');
    }
  }

  const unresolvedObligations: UnresolvedFriendObligation[] = [];
  for (const pair of [...pairs.values()].sort((a, b) => compareIds(a.first, b.first) || compareIds(a.second, b.second))) {
    if (pair.signed === 0) continue;
    if (!mutualFriendshipKeys.has(canonicalFriendshipKey(pair.first, pair.second))) {
      unresolvedObligations.push({
        fromUserId: pair.signed > 0 ? pair.first : pair.second,
        toUserId: pair.signed > 0 ? pair.second : pair.first,
        amountInPaise: Math.abs(pair.signed),
        reason: 'not_currently_mutual_friends',
      });
      continue;
    }
    if (pair.signed > 0) {
      if (pair.pendingSecondToFirst > 0) continue;
      const amountInPaise = pair.signed - pair.pendingFirstToSecond;
      if (amountInPaise > 0) suggestions.push({ fromUserId: pair.first, toUserId: pair.second, amountInPaise });
    } else {
      if (pair.pendingFirstToSecond > 0) continue;
      const amountInPaise = -pair.signed - pair.pendingSecondToFirst;
      if (amountInPaise > 0) suggestions.push({ fromUserId: pair.second, toUserId: pair.first, amountInPaise });
    }
  }

  const focusedSuggestions = suggestions.filter((suggestion) => !options.focusUserId
    || suggestion.fromUserId === options.focusUserId || suggestion.toUserId === options.focusUserId);
  const focusedUnresolved = unresolvedObligations.filter((item) => !options.focusUserId
    || item.fromUserId === options.focusUserId || item.toUserId === options.focusUserId);
  return {
    suggestions: focusedSuggestions.sort((a, b) => compareIds(a.fromUserId, b.fromUserId) || compareIds(a.toUserId, b.toUserId)),
    unresolvedObligations: focusedUnresolved.sort((a, b) => compareIds(a.fromUserId, b.fromUserId) || compareIds(a.toUserId, b.toUserId)),
  };
}
