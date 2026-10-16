const test = require('node:test');
const assert = require('node:assert/strict');
const { assertPaise, participantSum, validateEqualShares, makeObligations, allObligationsPaid, splitStatus } = require('../splitDomain');

test('creator included pays only other participants obligations', () => {
  const participants = [
    { userId: 'A', shareAmountInPaise: 100000 },
    { userId: 'B', shareAmountInPaise: 100000 },
    { userId: 'C', shareAmountInPaise: 100000 },
  ];
  assert.equal(participantSum(participants), 300000);
  assert.deepEqual(makeObligations(participants, 'A').map(({ fromUserId, amountInPaise }) => ({ fromUserId, amountInPaise })), [
    { fromUserId: 'B', amountInPaise: 100000 },
    { fromUserId: 'C', amountInPaise: 100000 },
  ]);
});

test('creator excluded receives every participant obligation', () => {
  const participants = [
    { userId: 'B', shareAmountInPaise: 150000 },
    { userId: 'C', shareAmountInPaise: 150000 },
  ];
  assert.equal(participantSum(participants), 300000);
  assert.deepEqual(makeObligations(participants, 'A').map((item) => item.toUserId), ['A', 'A']);
});

test('equal shares assign remainder paise deterministically', () => {
  assert.equal(validateEqualShares(100, [
    { userId: 'A', shareAmountInPaise: 34 },
    { userId: 'B', shareAmountInPaise: 33 },
    { userId: 'C', shareAmountInPaise: 33 },
  ]), true);
  assert.throws(() => validateEqualShares(100, [
    { userId: 'A', shareAmountInPaise: 33 },
    { userId: 'B', shareAmountInPaise: 34 },
    { userId: 'C', shareAmountInPaise: 33 },
  ]), /deterministic/);
});

test('paise and participant validation fails closed', () => {
  assert.throws(() => assertPaise(1.2, 'amount'));
  assert.throws(() => participantSum([{ userId: 'B', shareAmountInPaise: 100 }, { userId: 'B', shareAmountInPaise: 0 }]));
  assert.throws(() => participantSum([]));
});

test('pending acknowledgments do not count as paid and final obligations enter finalization', () => {
  const pending = [{ amountInPaise: 500, acceptedAmountInPaise: 0, pendingAmountInPaise: 500 }];
  assert.equal(allObligationsPaid(pending), false);
  assert.equal(splitStatus(pending), 'pending_settlement');
  const settled = [{ amountInPaise: 500, acceptedAmountInPaise: 500, pendingAmountInPaise: 0 }];
  assert.equal(allObligationsPaid(settled), true);
  assert.equal(splitStatus(settled), 'finalizing');
  assert.equal(splitStatus([]), 'finalizing');
});
