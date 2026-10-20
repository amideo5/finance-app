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
  for (const settlement of settlements) {
    if (settlement.status !== 'accepted') continue;
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
  for (const settlement of settlements) {
    if (settlement.status !== 'accepted') continue;
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
