import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addContributionInterval,
  addMonthsFromAnchor,
  calculateAccruedValueInPaise,
  calculateEstimatedDailyGrowthInPaise,
  compoundPrincipal,
  getDaysBetween,
  getNextContributionSchedule,
  getNextUnprocessedContributionSchedule,
  isValidDateKey,
} from '../src/services/calculations/investmentGrowth.ts';

test('validates calendar date keys without accepting impossible dates', () => {
  assert.equal(isValidDateKey('2026-02-28'), true);
  assert.equal(isValidDateKey('2026-02-30'), false);
  assert.equal(isValidDateKey('28-02-2026'), false);
});

test('monthly intervals preserve the original day when the next month is shorter', () => {
  assert.equal(addMonthsFromAnchor('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsFromAnchor('2026-01-31', 2), '2026-03-31');
  assert.equal(addContributionInterval('2026-01-31', 'monthly', 2), '2026-03-31');
  assert.equal(addContributionInterval('2026-01-01', 'weekly', 2), '2026-01-15');
});

test('compound interest accrues based on elapsed days and configured frequency', () => {
  const principal = 100_000; // ₹1,000 in paise
  assert.equal(compoundPrincipal(principal, 0, 365, 'quarterly'), principal);
  assert.ok(compoundPrincipal(principal, 8, 365, 'quarterly') > principal);
  assert.equal(getDaysBetween('2026-01-01', '2026-01-02'), 1);
});

test('FD/RD valuation accrues dated cash flows and excludes future contributions', () => {
  const flows = [
    { type: 'opening_balance', date: '2026-01-01', amountInPaise: 100_000 },
    { type: 'contribution', date: '2026-02-01', amountInPaise: 10_000 },
    { type: 'contribution', date: '2027-01-01', amountInPaise: 99_999 },
  ];
  const value = calculateAccruedValueInPaise(flows, 8, '2026-03-01', 'quarterly');
  assert.ok(value > 110_000);
  assert.ok(value < 120_000);
});

test('estimated daily growth does not count a contribution made today as interest', () => {
  const flows = [
    { type: 'opening_balance', date: '2026-01-01', amountInPaise: 100_000 },
    { type: 'contribution', date: '2026-01-02', amountInPaise: 50_000 },
  ];
  const growth = calculateEstimatedDailyGrowthInPaise(flows, 8, '2026-01-02', 'quarterly');
  const onlyOpeningGrowth = calculateAccruedValueInPaise([flows[0]], 8, '2026-01-02', 'quarterly')
    - calculateAccruedValueInPaise([flows[0]], 8, '2026-01-01', 'quarterly');
  assert.equal(growth, onlyOpeningGrowth);
});

test('RD scheduling starts at the next anchored interval without retroactive catch-up', () => {
  assert.deepEqual(
    getNextContributionSchedule('2025-01-31', 'monthly', '2026-10-29'),
    { index: 21, date: '2026-10-31' },
  );
  assert.deepEqual(
    getNextContributionSchedule('2026-10-29', 'monthly', '2026-10-29'),
    { index: 1, date: '2026-11-29' },
  );
});


test('backdated weekly RD initializes at the first missed installment and resumes after the last posted date', () => {
  assert.deepEqual(
    getNextUnprocessedContributionSchedule('2026-10-20', 'weekly', null),
    { index: 1, date: '2026-10-27' },
  );
  assert.deepEqual(
    getNextUnprocessedContributionSchedule('2026-10-20', 'weekly', '2026-10-27'),
    { index: 2, date: '2026-11-03' },
  );
});

test('backdated daily-compounding RD accrues interest separately from each deposit date', () => {
  const flows = [
    { type: 'opening_balance', date: '2026-10-20', amountInPaise: 500_000 },
    { type: 'contribution', date: '2026-10-27', amountInPaise: 500_000 },
  ];
  // 12 days of interest on the opening deposit, 5 days on the weekly installment.
  assert.equal(calculateAccruedValueInPaise(flows, 5, '2026-11-01', 'daily'), 1_001_166);
});
