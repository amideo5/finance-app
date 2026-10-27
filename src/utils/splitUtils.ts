import type {
  SharedExpenseSplit,
  SplitObligation,
  SplitParticipant,
  SplitSettlement,
  FriendSettlement,
} from '@/types/finance';

export interface SettlementSuggestion {
  fromUserId: string;
  toUserId: string;
  amountInPaise: number;
  settlementMode?: 'clique_net';
}

export function allocateEqualShares(totalAmountInPaise: number, userIds: string[]): SplitParticipant[] {
  validatePositivePaise(totalAmountInPaise, 'Total');
  assertUniqueParticipants(userIds);
  if (userIds.length === 0) throw new Error('At least one participant is required.');
  const base = Math.floor(totalAmountInPaise / userIds.length);
  const remainder = totalAmountInPaise % userIds.length;
  return userIds.map((userId, index) => ({
    userId,
    shareAmountInPaise: base + (index < remainder ? 1 : 0),
  }));
}

export function validateCustomShares(totalAmountInPaise: number, participants: SplitParticipant[]): void {
  validatePositivePaise(totalAmountInPaise, 'Total');
  validateParticipants(participants);
  if (participants.some(({ shareAmountInPaise }) => !Number.isSafeInteger(shareAmountInPaise) || shareAmountInPaise < 0)) {
    throw new Error('Participant shares must be non-negative whole paise amounts.');
  }
  const sum = participants.reduce((acc, participant) => acc + participant.shareAmountInPaise, 0);
  if (sum !== totalAmountInPaise) throw new Error('Participant shares must add up exactly to the expense total.');
}

export function getSplitObligations(split: SharedExpenseSplit): SplitObligation[] {
  validateSplit(split);
  return split.participants
    .filter((participant) => participant.userId !== split.paidByUserId && participant.shareAmountInPaise > 0)
    .map((participant) => ({
      fromUserId: participant.userId,
      toUserId: split.paidByUserId,
      amountInPaise: participant.shareAmountInPaise,
      acceptedAmountInPaise: 0,
      pendingAmountInPaise: 0,
    }));
}

export function getOutstandingObligations(
  splits: SharedExpenseSplit[],
  settlements: SplitSettlement[] = [],
): SettlementSuggestion[] {
  const remaining = new Map<string, number>();
  for (const split of splits) {
    if (split.status === 'cancelled') continue;
    for (const obligation of getSplitObligations(split)) {
      const key = obligationKey(split.id, obligation.fromUserId, obligation.toUserId);
      remaining.set(key, obligation.amountInPaise);
    }
  }
  for (const settlement of uniqueAcceptedSplitSettlements(settlements)) {
    const key = obligationKey(settlement.splitId, settlement.fromUserId, settlement.toUserId);
    const outstanding = remaining.get(key);
    if (outstanding === undefined || settlement.amountInPaise <= 0 || settlement.amountInPaise > outstanding) {
      throw new Error('Settlement records do not reconcile with split obligations.');
    }
    remaining.set(key, outstanding - settlement.amountInPaise);
  }
  const splitById = new Map(splits.map((split) => [split.id, split]));
  const results: SettlementSuggestion[] = [];
  for (const [key, amountInPaise] of remaining) {
    if (amountInPaise <= 0) continue;
    const [splitId, fromUserId, toUserId] = key.split('\u0000');
    if (!splitById.has(splitId)) continue;
    results.push({ fromUserId, toUserId, amountInPaise });
  }
  return results.sort((a, b) => a.fromUserId.localeCompare(b.fromUserId) || a.toUserId.localeCompare(b.toUserId));
}

/** Positive = should receive; negative = owes. Only accepted settlements are applied. */
export function calculateNetBalances(
  splits: SharedExpenseSplit[],
  settlements: SplitSettlement[] = [],
): Record<string, number> {
  const balances: Record<string, number> = {};
  const obligations = new Map<string, number>();
  for (const split of splits) {
    if (split.status === 'cancelled') continue;
    validateSplit(split);
    balances[split.paidByUserId] = (balances[split.paidByUserId] || 0) + split.totalAmountInPaise;
    for (const participant of split.participants) {
      balances[participant.userId] = (balances[participant.userId] || 0) - participant.shareAmountInPaise;
      if (participant.userId !== split.paidByUserId) {
        obligations.set(obligationKey(split.id, participant.userId, split.paidByUserId), participant.shareAmountInPaise);
      }
    }
  }
  for (const settlement of uniqueAcceptedSplitSettlements(settlements)) {
    if (!Number.isSafeInteger(settlement.amountInPaise) || settlement.amountInPaise <= 0) {
      throw new Error('Accepted settlements must have a positive whole-paise amount.');
    }
    const key = obligationKey(settlement.splitId, settlement.fromUserId, settlement.toUserId);
    const outstanding = obligations.get(key);
    if (outstanding === undefined || settlement.amountInPaise > outstanding) {
      throw new Error('Settlement exceeds the outstanding split obligation.');
    }
    obligations.set(key, outstanding - settlement.amountInPaise);
    balances[settlement.fromUserId] = (balances[settlement.fromUserId] || 0) + settlement.amountInPaise;
    balances[settlement.toUserId] = (balances[settlement.toUserId] || 0) - settlement.amountInPaise;
  }
  const total = Object.values(balances).reduce((sum, amount) => sum + amount, 0);
  if (total !== 0) throw new Error(`Split balances do not reconcile to zero (${total} paise).`);
  return balances;
}


/**
 * Calculate network-wide net balances after accepted split repayments and
 * accepted friend-level payments. Pending requests reserve capacity on the
 * server but never count as money paid. Positive = should receive; negative = owes.
 */
export function calculateFriendNetBalances(
  splits: SharedExpenseSplit[],
  splitSettlements: SplitSettlement[] = [],
  friendSettlements: FriendSettlement[] = [],
): Record<string, number> {
  const balances = calculateNetBalances(splits, splitSettlements);
  for (const settlement of friendSettlements) {
    if (settlement.status !== 'accepted') continue;
    if (!Number.isSafeInteger(settlement.amountInPaise) || settlement.amountInPaise <= 0) {
      throw new Error('Accepted friend settlements must have a positive whole-paise amount.');
    }
    if (!settlement.fromUserId || !settlement.toUserId || settlement.fromUserId === settlement.toUserId) {
      throw new Error('Accepted friend settlement has invalid participants.');
    }
    // A global payment reduces the payer's debt and the recipient's credit.
    balances[settlement.fromUserId] = (balances[settlement.fromUserId] || 0) + settlement.amountInPaise;
    balances[settlement.toUserId] = (balances[settlement.toUserId] || 0) - settlement.amountInPaise;
  }
  const total = Object.values(balances).reduce((sum, amount) => sum + amount, 0);
  if (total !== 0) throw new Error(`Friend net balances do not reconcile to zero (${total} paise).`);
  return balances;
}

/** Greedy deterministic matching; inputs must be whole-paise balances summing to zero. */
export function simplifyDebts(balances: Record<string, number>): SettlementSuggestion[] {
  const values = Object.entries(balances).sort(([a], [b]) => a.localeCompare(b));
  if (values.some(([, amount]) => !Number.isSafeInteger(amount))) throw new Error('Balances must be whole paise amounts.');
  const sum = values.reduce((total, [, amount]) => total + amount, 0);
  if (sum !== 0) throw new Error(`Balances must reconcile to zero (${sum} paise).`);
  const debtors = values.filter(([, amount]) => amount < 0).map(([userId, amount]) => ({ userId, amount: -amount }));
  const creditors = values.filter(([, amount]) => amount > 0).map(([userId, amount]) => ({ userId, amount }));
  const suggestions: SettlementSuggestion[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountInPaise = Math.min(debtor.amount, creditor.amount);
    if (amountInPaise > 0) suggestions.push({ fromUserId: debtor.userId, toUserId: creditor.userId, amountInPaise });
    debtor.amount -= amountInPaise;
    creditor.amount -= amountInPaise;
    if (debtor.amount === 0) debtorIndex++;
    if (creditor.amount === 0) creditorIndex++;
  }
  if (debtorIndex !== debtors.length || creditorIndex !== creditors.length) throw new Error('Debts could not be reconciled.');
  return suggestions;
}

export function buildMaps(
  settlements: SettlementSuggestion[],
  currentUser: string,
): { oweMap: Record<string, number>; getMap: Record<string, number> } {
  const oweMap: Record<string, number> = {};
  const getMap: Record<string, number> = {};
  for (const settlement of settlements) {
    if (settlement.amountInPaise <= 0) continue;
    if (settlement.fromUserId === currentUser) oweMap[settlement.toUserId] = (oweMap[settlement.toUserId] || 0) + settlement.amountInPaise;
    else if (settlement.toUserId === currentUser) getMap[settlement.fromUserId] = (getMap[settlement.fromUserId] || 0) + settlement.amountInPaise;
  }
  return { oweMap, getMap };
}

export function deriveSplitStatus(split: SharedExpenseSplit, settlements: SplitSettlement[]): SharedExpenseSplit['status'] {
  if (split.status === 'cancelled') return 'cancelled';
  const outstanding = getOutstandingObligations([split], settlements).reduce((sum, item) => sum + item.amountInPaise, 0);
  if (outstanding === 0) return split.finalizationStatus === 'complete' ? 'settled' : 'finalizing';
  const accepted = settlements.some((settlement) => settlement.splitId === split.id && settlement.status === 'accepted');
  return accepted ? 'partially_settled' : 'pending_settlement';
}

function validateSplit(split: SharedExpenseSplit): void {
  if (!split || split.currency !== 'INR' || split.createdBy !== split.paidByUserId) throw new Error('Invalid split payer or currency.');
  validateCustomShares(split.totalAmountInPaise, split.participants);
  if (!split.sourceProfileId || !split.sourceTransactionId || !split.id) throw new Error('Split source references are required.');
}

function validateParticipants(participants: SplitParticipant[]): void {
  if (!Array.isArray(participants) || participants.length === 0) throw new Error('At least one participant is required.');
  assertUniqueParticipants(participants.map((participant) => participant.userId));
  if (participants.some((participant) => !participant.userId || typeof participant.userId !== 'string')) throw new Error('Every participant needs a valid user ID.');
}

function assertUniqueParticipants(userIds: string[]): void {
  if (!Array.isArray(userIds) || userIds.some((userId) => !userId) || new Set(userIds).size !== userIds.length) {
    throw new Error('Participant IDs must be valid and unique.');
  }
}

function validatePositivePaise(amount: number, label: string): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`${label} must be a positive whole-paise amount.`);
}

function obligationKey(splitId: string, fromUserId: string, toUserId: string): string {
  return `${splitId}\u0000${fromUserId}\u0000${toUserId}`;
}

/**
 * Deduplicate legacy duplicate accepted settlement rows by idempotency key.
 * If an idempotency key was reused with different financial data, fail closed.
 */
function uniqueAcceptedSplitSettlements(settlements: SplitSettlement[]): SplitSettlement[] {
  const unique = new Map<string, SplitSettlement>();
  for (const settlement of settlements) {
    if (settlement.status !== 'accepted') continue;
    const key = settlement.idempotencyKey?.trim() || settlement.id;
    const previous = unique.get(key);
    if (!previous) {
      unique.set(key, settlement);
      continue;
    }
    if (
      previous.splitId !== settlement.splitId
      || previous.fromUserId !== settlement.fromUserId
      || previous.toUserId !== settlement.toUserId
      || previous.amountInPaise !== settlement.amountInPaise
    ) {
      throw new Error('Duplicate settlement idempotency keys contain conflicting financial data.');
    }
  }
  return [...unique.values()];
}

/**
 * Deterministic maximum-flow matching between net debtors and creditors, with
 * direct friendship edges only. This utility is useful when aggregate netting is
 * explicitly allowed by the caller; the live product's current settlement path
 * intentionally retains bilateral obligations and does not use this to rewrite debt.
 */
export function simplifyDebtsWithFriendships(
  balances: Record<string, number>,
  friendships: Array<[string, string]>,
): SettlementSuggestion[] {
  const entries = Object.entries(balances).sort(([a], [b]) => a.localeCompare(b));
  if (entries.some(([, amount]) => !Number.isSafeInteger(amount))) {
    throw new Error('Balances must be whole paise amounts.');
  }
  const total = entries.reduce((sum, [, amount]) => sum + amount, 0);
  if (!Number.isSafeInteger(total) || total !== 0) {
    throw new Error(`Balances must reconcile to zero (${total} paise).`);
  }

  const debtors = entries.filter(([, amount]) => amount < 0).map(([userId, amount]) => ({ userId, remaining: -amount }));
  const creditors = entries.filter(([, amount]) => amount > 0).map(([userId, amount]) => ({ userId, remaining: amount }));
  if (debtors.length === 0 || creditors.length === 0) return [];

  const normalizedFriendships = new Set<string>();
  for (const [a, b] of friendships) {
    if (!a || !b || a === b) continue;
    normalizedFriendships.add(obligationPairKey(a, b));
  }

  type Edge = { to: number; reverseIndex: number; capacity: number; initialCapacity: number };
  const source = 0;
  const debtorOffset = 1;
  const creditorOffset = debtorOffset + debtors.length;
  const sink = creditorOffset + creditors.length;
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);
  const addEdge = (from: number, to: number, capacity: number): Edge => {
    const forward: Edge = { to, reverseIndex: graph[to].length, capacity, initialCapacity: capacity };
    const reverse: Edge = { to: from, reverseIndex: graph[from].length, capacity: 0, initialCapacity: 0 };
    graph[from].push(forward);
    graph[to].push(reverse);
    return forward;
  };

  const debtorCreditorEdges: Array<{ debtorIndex: number; creditorIndex: number; edge: Edge }> = [];
  const totalDebt = debtors.reduce((sum, debtor) => sum + debtor.remaining, 0);
  debtors.forEach((debtor, debtorIndex) => addEdge(source, debtorOffset + debtorIndex, debtor.remaining));
  creditors.forEach((creditor, creditorIndex) => addEdge(creditorOffset + creditorIndex, sink, creditor.remaining));
  debtors.forEach((debtor, debtorIndex) => {
    creditors.forEach((creditor, creditorIndex) => {
      if (!normalizedFriendships.has(obligationPairKey(debtor.userId, creditor.userId))) return;
      debtorCreditorEdges.push({
        debtorIndex,
        creditorIndex,
        edge: addEdge(debtorOffset + debtorIndex, creditorOffset + creditorIndex, totalDebt),
      });
    });
  });

  // Edmonds–Karp gives deterministic maximum flow because node/edge iteration is sorted.
  while (true) {
    const parentNode = Array<number>(graph.length).fill(-1);
    const parentEdge = Array<number>(graph.length).fill(-1);
    const queue = [source];
    parentNode[source] = source;
    for (let head = 0; head < queue.length && parentNode[sink] === -1; head++) {
      const node = queue[head];
      for (let edgeIndex = 0; edgeIndex < graph[node].length; edgeIndex++) {
        const edge = graph[node][edgeIndex];
        if (edge.capacity <= 0 || parentNode[edge.to] !== -1) continue;
        parentNode[edge.to] = node;
        parentEdge[edge.to] = edgeIndex;
        queue.push(edge.to);
        if (edge.to === sink) break;
      }
    }
    if (parentNode[sink] === -1) break;

    let augment = Number.MAX_SAFE_INTEGER;
    for (let node = sink; node !== source; node = parentNode[node]) {
      augment = Math.min(augment, graph[parentNode[node]][parentEdge[node]].capacity);
    }
    if (!Number.isSafeInteger(augment) || augment <= 0) throw new Error('Invalid settlement flow amount.');
    for (let node = sink; node !== source; node = parentNode[node]) {
      const edge = graph[parentNode[node]][parentEdge[node]];
      edge.capacity -= augment;
      graph[node][edge.reverseIndex].capacity += augment;
    }
  }

  return debtorCreditorEdges.map(({ debtorIndex, creditorIndex, edge }) => ({
    fromUserId: debtors[debtorIndex].userId,
    toUserId: creditors[creditorIndex].userId,
    amountInPaise: edge.initialCapacity - edge.capacity,
  })).filter((item) => item.amountInPaise > 0).sort((a, b) =>
    a.fromUserId.localeCompare(b.fromUserId) || a.toUserId.localeCompare(b.toUserId),
  );
}

function obligationPairKey(userA: string, userB: string): string {
  const [first, second] = [userA, userB].sort((a, b) => a.localeCompare(b));
  return `${first}\u0000${second}`;
}

