import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMutualFriendshipKeys,
  calculateFriendshipAwarePlan,
  canonicalFriendshipKey,
  type FriendshipRecord,
  type LedgerFriendSettlement,
  type LedgerObligation,
} from '../supabase/functions/_shared/settlement.ts';

const friendshipRecords = (...pairs: Array<[string, string]>): FriendshipRecord[] => pairs.flatMap(([userId, friendId]) => [
  { userId, friendId },
  { userId: friendId, friendId: userId },
]);
const friendKeys = (...pairs: Array<[string, string]>) => buildMutualFriendshipKeys(friendshipRecords(...pairs));
const obligation = (fromUserId: string, toUserId: string, amountInPaise: number, extra: Partial<LedgerObligation> = {}): LedgerObligation => ({
  fromUserId, toUserId, amountInPaise, acceptedAmountInPaise: 0, pendingAmountInPaise: 0, ...extra,
});
const settlement = (fromUserId: string, toUserId: string, amountInPaise: number, extra: Partial<LedgerFriendSettlement> = {}): LedgerFriendSettlement => ({
  id: `settlement-${fromUserId}-${toUserId}-${amountInPaise}`,
  fromUserId, toUserId, amountInPaise, status: 'accepted',
  idempotencyKey: `idem-${fromUserId}-${toUserId}-${amountInPaise}`,
  ...extra,
});
const plan = (obligations: LedgerObligation[], edges: Set<string>, settlements: LedgerFriendSettlement[] = []) =>
  calculateFriendshipAwarePlan(obligations, settlements, edges);

test('1. fully connected friend group retains pairwise balances and only direct-edge payments', () => {
  const edges = friendKeys(['A', 'B'], ['A', 'C'], ['A', 'D'], ['B', 'C'], ['B', 'D'], ['C', 'D']);
  const result = plan([
    obligation('A', 'B', 10_000),
    obligation('B', 'A', 2_000),
    obligation('C', 'A', 3_000),
    obligation('D', 'C', 1_000),
  ], edges);
  assert.deepEqual(result.suggestions, [
    { fromUserId: 'A', toUserId: 'B', amountInPaise: 8_000 },
    { fromUserId: 'C', toUserId: 'A', amountInPaise: 3_000 },
    { fromUserId: 'D', toUserId: 'C', amountInPaise: 1_000 },
  ]);
  assert.deepEqual(result.unresolvedObligations, []);
});

test('2. E can settle with A but not with A’s other friends', () => {
  const edges = friendKeys(['A', 'B'], ['A', 'C'], ['A', 'D'], ['B', 'C'], ['B', 'D'], ['C', 'D'], ['A', 'E']);
  const result = plan([
    obligation('E', 'A', 50_000),
    obligation('B', 'E', 20_000),
    obligation('C', 'D', 10_000),
  ], edges);
  assert.deepEqual(result.suggestions, [
    { fromUserId: 'C', toUserId: 'D', amountInPaise: 10_000 },
    { fromUserId: 'E', toUserId: 'A', amountInPaise: 50_000 },
  ]);
  assert.deepEqual(result.unresolvedObligations, [{
    fromUserId: 'B', toUserId: 'E', amountInPaise: 20_000, reason: 'not_currently_mutual_friends',
  }]);
  assert.equal(result.suggestions.some((item) => item.fromUserId === 'E' && ['B', 'C', 'D'].includes(item.toUserId)), false);
});

test('3. a friendship chain never permits a direct non-friend payment', () => {
  const edges = friendKeys(['A', 'B'], ['B', 'C']);
  const result = plan([obligation('A', 'C', 1_000), obligation('A', 'B', 500)], edges);
  assert.deepEqual(result.suggestions, [{ fromUserId: 'A', toUserId: 'B', amountInPaise: 500 }]);
  assert.deepEqual(result.unresolvedObligations, [{
    fromUserId: 'A', toUserId: 'C', amountInPaise: 1_000, reason: 'not_currently_mutual_friends',
  }]);
});

test('4. disconnected groups are not netted across their component boundary', () => {
  const edges = friendKeys(['A', 'B'], ['B', 'C'], ['D', 'E']);
  const result = plan([obligation('A', 'D', 9_900), obligation('B', 'C', 1_000), obligation('D', 'E', 2_000)], edges);
  assert.deepEqual(result.suggestions, [
    { fromUserId: 'B', toUserId: 'C', amountInPaise: 1_000 },
    { fromUserId: 'D', toUserId: 'E', amountInPaise: 2_000 },
  ]);
  assert.equal(result.suggestions.some((item) => item.fromUserId === 'A' && item.toUserId === 'D'), false);
  assert.equal(result.unresolvedObligations[0].amountInPaise, 9_900);
});

test('5. a historical split does not create a friendship', () => {
  const result = plan([obligation('A', 'B', 4_200)], new Set());
  assert.deepEqual(result.suggestions, []);
  assert.deepEqual(result.unresolvedObligations, [{
    fromUserId: 'A', toUserId: 'B', amountInPaise: 4_200, reason: 'not_currently_mutual_friends',
  }]);
});

test('6. multiple splits between the same pair aggregate without double-counting', () => {
  const result = plan([
    obligation('A', 'B', 10_000),
    obligation('A', 'B', 20_000),
    obligation('B', 'A', 5_000),
  ], friendKeys(['A', 'B']), [settlement('A', 'B', 2_000)]);
  assert.deepEqual(result.suggestions, [{ fromUserId: 'A', toUserId: 'B', amountInPaise: 23_000 }]);
});

test('7. partial repayments reduce the outstanding amount exactly', () => {
  const result = plan([obligation('A', 'B', 10_000, { acceptedAmountInPaise: 6_789 })], friendKeys(['A', 'B']));
  assert.deepEqual(result.suggestions, [{ fromUserId: 'A', toUserId: 'B', amountInPaise: 3_211 }]);
});

test('8. cancelled obligations are ignored and completed obligations at zero outstanding do not suggest payment', () => {
  const result = plan([
    obligation('A', 'B', 20_000, { splitStatus: 'cancelled' } as Partial<LedgerObligation>),
    obligation('B', 'C', 8_000, { acceptedAmountInPaise: 8_000 }),
  ], friendKeys(['A', 'B'], ['B', 'C']));
  assert.deepEqual(result.suggestions, []);
  assert.deepEqual(result.unresolvedObligations, []);
});

test('9. zero bilateral net balance produces no unnecessary payment', () => {
  assert.deepEqual(plan([
    obligation('A', 'B', 7_000), obligation('B', 'A', 7_000),
  ], friendKeys(['A', 'B'])).suggestions, []);
});

test('10. multiple debtors and creditors remain accurate at the bilateral pair level', () => {
  const edges = friendKeys(['A', 'B'], ['A', 'C'], ['B', 'C'], ['A', 'D'], ['B', 'D'], ['C', 'D']);
  const result = plan([
    obligation('A', 'C', 1_000),
    obligation('B', 'C', 2_000),
    obligation('D', 'A', 3_000),
  ], edges);
  assert.deepEqual(result.suggestions, [
    { fromUserId: 'A', toUserId: 'C', amountInPaise: 1_000 },
    { fromUserId: 'B', toUserId: 'C', amountInPaise: 2_000 },
    { fromUserId: 'D', toUserId: 'A', amountInPaise: 3_000 },
  ]);
  for (const item of result.suggestions) {
    assert.ok(edges.has(canonicalFriendshipKey(item.fromUserId, item.toUserId)));
    assert.ok(item.amountInPaise > 0);
  }
});

test('11. pending requests do not create an eligible friendship', () => {
  const edges = buildMutualFriendshipKeys([{ userId: 'A', friendId: 'B' }]);
  assert.deepEqual(plan([obligation('A', 'B', 1_500)], edges).suggestions, []);
});

test('12. a revoked/blocked friendship removes payment eligibility but preserves debt', () => {
  // The app's supported removal operation deletes both directional records.
  const edgesAfterRemoval = buildMutualFriendshipKeys([]);
  const result = plan([obligation('A', 'B', 1_500)], edgesAfterRemoval);
  assert.equal(result.suggestions.length, 0);
  assert.equal(result.unresolvedObligations[0].amountInPaise, 1_500);
});

test('13. missing friendship records fail closed', () => {
  const edges = buildMutualFriendshipKeys([{ userId: 'A', friendId: 'C' }]);
  const result = plan([obligation('A', 'B', 1_000)], edges);
  assert.deepEqual(result.suggestions, []);
  assert.equal(result.unresolvedObligations.length, 1);
});

test('14. inconsistent financial ledger amounts fail closed', () => {
  assert.throws(() => plan([
    obligation('A', 'B', 100, { acceptedAmountInPaise: 101 }),
  ], friendKeys(['A', 'B'])), /exceed a split obligation/);
});

test('15. currency arithmetic is exact to the integer paise', () => {
  const result = plan([obligation('A', 'B', 1_001)], friendKeys(['A', 'B']));
  assert.equal(result.suggestions[0].amountInPaise, 1_001);
  assert.equal(Number.isSafeInteger(result.suggestions[0].amountInPaise), true);
});

test('16. a debt with no direct eligible edge stays unresolved even if a friendship path exists', () => {
  const result = plan([obligation('A', 'C', 5_000)], friendKeys(['A', 'B'], ['B', 'C']));
  assert.deepEqual(result.suggestions, []);
  assert.equal(result.unresolvedObligations[0].amountInPaise, 5_000);
});

test('17. repeated calculation produces identical ordered suggestions', () => {
  const input = [obligation('Z', 'A', 2_000), obligation('B', 'C', 1_000), obligation('A', 'Z', 500)];
  const edges = friendKeys(['Z', 'A'], ['B', 'C']);
  assert.deepEqual(plan(input, edges), plan(input, edges));
});

test('18. a formerly valid suggestion is removed after friendship revocation', () => {
  const debts = [obligation('A', 'B', 9_000)];
  assert.deepEqual(plan(debts, friendKeys(['A', 'B'])).suggestions, [
    { fromUserId: 'A', toUserId: 'B', amountInPaise: 9_000 },
  ]);
  const revalidated = plan(debts, new Set());
  assert.deepEqual(revalidated.suggestions, []);
  assert.equal(revalidated.unresolvedObligations[0].amountInPaise, 9_000);
});

test('19. one directional friend record can never grant authorization', () => {
  const partial = [{ userId: 'A', friendId: 'B' }];
  assert.equal(buildMutualFriendshipKeys(partial).has(canonicalFriendshipKey('A', 'B')), false);
});

test('20. duplicated accepted confirmation rows with one idempotency key count once', () => {
  const payment = settlement('A', 'B', 3_000, { idempotencyKey: 'same-idempotency-key' });
  const duplicate = { ...payment, id: 'duplicate-copy' };
  const result = plan([obligation('A', 'B', 10_000)], friendKeys(['A', 'B']), [payment, duplicate]);
  assert.deepEqual(result.suggestions, [{ fromUserId: 'A', toUserId: 'B', amountInPaise: 7_000 }]);
});

test('pending payments reserve capacity but are not treated as paid', () => {
  const result = plan(
    [obligation('A', 'B', 10_000)],
    friendKeys(['A', 'B']),
    [settlement('A', 'B', 4_000, { status: 'pending', idempotencyKey: 'pending-1' })],
  );
  assert.deepEqual(result.suggestions, [{ fromUserId: 'A', toUserId: 'B', amountInPaise: 6_000 }]);
});

test('opposite-direction pending request blocks a potentially stale new suggestion', () => {
  const result = plan(
    [obligation('A', 'B', 10_000)],
    friendKeys(['A', 'B']),
    [settlement('B', 'A', 1_000, { status: 'pending', idempotencyKey: 'reverse-pending' })],
  );
  assert.deepEqual(result.suggestions, []);
});

test('conflicting financial records that reuse an idempotency key fail closed', () => {
  const first = settlement('A', 'B', 1_000, { idempotencyKey: 'reused' });
  const conflicting = settlement('A', 'B', 2_000, { idempotencyKey: 'reused' });
  assert.throws(() => plan([obligation('A', 'B', 10_000)], friendKeys(['A', 'B']), [first, conflicting]), /conflicting financial data/);
});


test('canonical friendship keys use the backend bytewise ordering for case-sensitive IDs', () => {
  const keys = buildMutualFriendshipKeys(friendshipRecords(['aZ', 'aa']));
  assert.equal(keys.has(canonicalFriendshipKey('aa', 'aZ')), true);
});

test('a settled split with a nonzero outstanding obligation is treated as inconsistent', () => {
  assert.throws(() => plan([
    obligation('A', 'B', 1_000, { splitStatus: 'settled' }),
  ], friendKeys(['A', 'B'])), /Settled split status conflicts/);
});

test('overflowing pair totals fail closed rather than losing paise precision', () => {
  assert.throws(() => plan([
    obligation('A', 'B', Number.MAX_SAFE_INTEGER),
    obligation('A', 'B', 1),
  ], friendKeys(['A', 'B'])), /safe whole-paise range/);
});


test('friendship document IDs must match their stored participant direction', () => {
  const corrupted = buildMutualFriendshipKeys([
    { userId: 'A', friendId: 'B', documentId: 'A_B' },
    { userId: 'B', friendId: 'A', documentId: 'B_X' },
  ]);
  assert.equal(corrupted.has(canonicalFriendshipKey('A', 'B')), false);
});


test('suggestion results can be scoped to the signed-in user only', () => {
  const result = calculateFriendshipAwarePlan(
    [obligation('A', 'B', 1_000), obligation('C', 'D', 2_000)],
    [],
    friendKeys(['A', 'B'], ['C', 'D']),
    { focusUserId: 'A' },
  );
  assert.deepEqual(result.suggestions, [{ fromUserId: 'A', toUserId: 'B', amountInPaise: 1_000 }]);
  assert.deepEqual(result.unresolvedObligations, []);
});

test('excluding the settlement being confirmed does not double-reserve itself', () => {
  const pending = settlement('A', 'B', 4_000, { id: 'confirm-me', status: 'pending', idempotencyKey: 'confirm-me' });
  const result = calculateFriendshipAwarePlan(
    [obligation('A', 'B', 10_000)],
    [pending],
    friendKeys(['A', 'B']),
    { focusUserId: 'A', excludePendingSettlementId: 'confirm-me' },
  );
  assert.deepEqual(result.suggestions, [{ fromUserId: 'A', toUserId: 'B', amountInPaise: 10_000 }]);
});
