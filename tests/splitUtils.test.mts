import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateEqualShares,
  calculateNetBalances,
  calculateFriendNetBalances,
  getOutstandingObligations,
  simplifyDebts,
  simplifyDebtsWithFriendships,
  validateCustomShares,
} from '../src/utils/splitUtils.ts';
import type { SharedExpenseSplit, SplitSettlement } from '../types/finance.ts';

function split(overrides: Partial<SharedExpenseSplit> = {}): SharedExpenseSplit {
  return {
    id: 'split-a', title: 'Dinner', createdBy: 'A', paidByUserId: 'A',
    sourceProfileId: 'profile-a', sourceTransactionId: 'tx-a', totalAmountInPaise: 300000,
    currency: 'INR', type: 'equal', participants: [
      { userId: 'A', shareAmountInPaise: 100000 },
      { userId: 'B', shareAmountInPaise: 100000 },
      { userId: 'C', shareAmountInPaise: 100000 },
    ], participantIds: ['A', 'B', 'C'], obligations: [], status: 'pending_settlement',
    finalizationStatus: 'not_started', sourceDate: '2026-10-16', sourceCategory: 'Food',
    ...overrides,
  };
}

const settlement = (overrides: Partial<SplitSettlement> = {}): SplitSettlement => ({
  id: 'settlement-1', splitId: 'split-a', fromUserId: 'B', toUserId: 'A', amountInPaise: 40000,
  senderProfileId: 'profile-b', status: 'accepted', idempotencyKey: 'key-1', ...overrides,
});

test('equal allocation distributes remainder paise deterministically', () => {
  assert.deepEqual(allocateEqualShares(100, ['A', 'B', 'C']), [
    { userId: 'A', shareAmountInPaise: 34 },
    { userId: 'B', shareAmountInPaise: 33 },
    { userId: 'C', shareAmountInPaise: 33 },
  ]);
});

test('creator included: balances net payer share and create no self-obligation', () => {
  const balances = calculateNetBalances([split()]);
  assert.deepEqual(balances, { A: 200000, B: -100000, C: -100000 });
  assert.deepEqual(getOutstandingObligations([split()]), [
    { fromUserId: 'B', toUserId: 'A', amountInPaise: 100000 },
    { fromUserId: 'C', toUserId: 'A', amountInPaise: 100000 },
  ]);
});

test('creator excluded: creator has zero consumption allocation but receives all participant shares', () => {
  const creatorExcluded = split({ participants: [
    { userId: 'B', shareAmountInPaise: 150000 },
    { userId: 'C', shareAmountInPaise: 150000 },
  ], participantIds: ['B', 'C'] });
  assert.deepEqual(calculateNetBalances([creatorExcluded]), { A: 300000, B: -150000, C: -150000 });
  assert.equal(creatorExcluded.participants.some((participant) => participant.userId === 'A'), false);
});

test('accepted partial repayment reduces only the debtor obligation', () => {
  const balances = calculateNetBalances([split()], [settlement()]);
  assert.deepEqual(balances, { A: 160000, B: -60000, C: -100000 });
  assert.equal(Object.values(balances).reduce((sum, amount) => sum + amount, 0), 0);
});

test('pending/rejected/cancelled acknowledgments do not affect balances', () => {
  for (const status of ['pending', 'rejected', 'cancelled'] as const) {
    assert.deepEqual(calculateNetBalances([split()], [settlement({ status })]), { A: 200000, B: -100000, C: -100000 });
  }
});

test('multiple partial repayments settle the obligation exactly', () => {
  const repayments = [
    settlement({ amountInPaise: 40000 }),
    settlement({ id: 'settlement-2', amountInPaise: 60000, idempotencyKey: 'key-2' }),
  ];
  assert.deepEqual(calculateNetBalances([split()], repayments), { A: 100000, B: 0, C: -100000 });
  assert.equal(getOutstandingObligations([split()], repayments).find((item) => item.fromUserId === 'B'), undefined);
});


test('accepted friend-level payment reduces sender debt and recipient credit without mutating a specific split', () => {
  const friendPayment = {
    id: 'friend-settlement-1', fromUserId: 'B', toUserId: 'A', participantIds: ['A', 'B'],
    amountInPaise: 25000, status: 'accepted' as const, idempotencyKey: 'friend-key-1',
  };
  assert.deepEqual(calculateFriendNetBalances([split()], [], [friendPayment]), {
    A: 175000, B: -75000, C: -100000,
  });
  assert.equal(getOutstandingObligations([split()]).find((item) => item.fromUserId === 'B')?.amountInPaise, 100000);
});

test('pending friend-level requests do not change balances', () => {
  const pendingPayment = {
    id: 'friend-settlement-pending', fromUserId: 'B', toUserId: 'A', participantIds: ['A', 'B'],
    amountInPaise: 25000, status: 'pending' as const, idempotencyKey: 'friend-pending-key',
  };
  assert.deepEqual(calculateFriendNetBalances([split()], [], [pendingPayment]), calculateNetBalances([split()]));
});

test('custom allocations reject invalid totals and duplicate users', () => {
  assert.throws(() => validateCustomShares(100, [
    { userId: 'A', shareAmountInPaise: 50 }, { userId: 'B', shareAmountInPaise: 49 },
  ]), /exactly/);
  assert.throws(() => validateCustomShares(100, [
    { userId: 'A', shareAmountInPaise: 50 }, { userId: 'A', shareAmountInPaise: 50 },
  ]), /unique/);
});

test('debt simplification reconciles whole-paise balances deterministically', () => {
  assert.deepEqual(simplifyDebts({ A: 400, B: -250, C: -150 }), [
    { fromUserId: 'B', toUserId: 'A', amountInPaise: 250 },
    { fromUserId: 'C', toUserId: 'A', amountInPaise: 150 },
  ]);
  assert.throws(() => simplifyDebts({ A: 100, B: -99 }), /reconcile/);
});

test('cancelled splits are excluded from balances', () => {
  assert.deepEqual(calculateNetBalances([split({ status: 'cancelled' })]), {});
});


test('friend-only matching never redirects a shared balance across non-friends', () => {
  // B owes A and A owes D. The net positions are B=-5000, D=+5000,
  // but B and D are not friends, so they must not get a suggested payment.
  assert.deepEqual(simplifyDebtsWithFriendships(
    { A: 0, B: -5000, D: 5000 },
    [['A', 'B'], ['A', 'D']],
  ), []);
});

test('friend-only matching emits only directly accepted friend pairs', () => {
  assert.deepEqual(simplifyDebtsWithFriendships(
    { A: -10000, B: 6000, C: 4000 },
    [['A', 'B'], ['A', 'C']],
  ), [
    { fromUserId: 'A', toUserId: 'B', amountInPaise: 6000 },
    { fromUserId: 'A', toUserId: 'C', amountInPaise: 4000 },
  ]);
});
