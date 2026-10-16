import assert from 'node:assert/strict';
import test from 'node:test';
import { getReportableTransactions } from '../src/utils/splitReporting.ts';
import type { FinanceTransaction, SharedExpenseSplit } from '../types/finance.ts';

const transaction = (overrides: Partial<FinanceTransaction>): FinanceTransaction => ({
  id: 'source', profileId: 'profile-a', userId: 'A', type: 'expense', amount: 30,
  category: 'Dining', paymentMode: 'cash', accountId: null, notes: null,
  date: '2026-10-01', currency: 'INR', ...overrides,
});
const split = (overrides: Partial<SharedExpenseSplit> = {}): SharedExpenseSplit => ({
  id: 'split-a', title: 'Dinner', createdBy: 'A', paidByUserId: 'A',
  sourceProfileId: 'profile-a', sourceTransactionId: 'source', totalAmountInPaise: 3000,
  currency: 'INR', type: 'equal', participants: [
    { userId: 'A', shareAmountInPaise: 1000 },
    { userId: 'B', shareAmountInPaise: 1000 },
    { userId: 'C', shareAmountInPaise: 1000 },
  ], participantIds: ['A', 'B', 'C'], obligations: [], status: 'pending_settlement',
  finalizationStatus: 'not_started', sourceDate: '2026-10-01', sourceCategory: 'Dining', ...overrides,
});

test('included creator counts source gross until final allocations finalize', () => {
  const source = transaction({});
  assert.deepEqual(getReportableTransactions([source], [split()], 'profile-a'), [source]);
  assert.deepEqual(getReportableTransactions([source], [split({ status: 'settled', finalizationStatus: 'complete' })], 'profile-a'), []);
});

test('excluded creator does not count original expense even before finalization', () => {
  const source = transaction({});
  const creatorExcluded = split({
    participants: [{ userId: 'B', shareAmountInPaise: 1500 }, { userId: 'C', shareAmountInPaise: 1500 }],
    participantIds: ['B', 'C'],
  });
  assert.deepEqual(getReportableTransactions([source], [creatorExcluded], 'profile-a'), []);
});

test('cancelling a split restores ordinary source expense reporting', () => {
  const source = transaction({});
  const creatorExcluded = split({
    status: 'cancelled',
    participants: [{ userId: 'B', shareAmountInPaise: 3000 }],
    participantIds: ['B'],
  });
  assert.deepEqual(getReportableTransactions([source], [creatorExcluded], 'profile-a'), [source]);
});

test('repayment transfers are excluded from income and expense reporting', () => {
  const income = transaction({ id: 'income', type: 'income', amount: 4, kind: 'repayment' });
  const repaymentExpense = transaction({ id: 'repayment', type: 'expense', kind: 'repayment' });
  const normal = transaction({ id: 'ordinary' });
  assert.deepEqual(getReportableTransactions([income, repaymentExpense, normal], [], 'profile-a').map((item) => item.id), ['ordinary']);
});

test('final allocations retain source category for budgets and expense insights', () => {
  const allocation = transaction({
    id: 'allocation', kind: 'allocation', category: 'Split Expense',
    sourceCategory: 'Dining', sourceCategoryId: 'food', splitId: 'split-a',
  });
  const [reportable] = getReportableTransactions([allocation], [], 'profile-a');
  assert.equal(reportable.category, 'Dining');
  assert.equal(reportable.categoryId, 'food');
});

test('profile switching shows an allocation only in its stored participant profile', () => {
  const allocation = transaction({
    id: 'allocation', profileId: 'default-b', userId: 'B', kind: 'allocation',
    splitId: 'split-a', sourceProfileId: 'profile-a', sourceTransactionId: 'source',
    amount: 10, amountInPaise: 1000,
  });
  assert.equal(getReportableTransactions([allocation], [], 'default-b').length, 1);
  assert.equal(getReportableTransactions([allocation], [], 'profile-a').length, 0);
});
