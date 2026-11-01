import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMfApiDate, resolveHistoricalMutualFundNav } from '../src/services/marketData/mutualFundNav.ts';

const sample = [
  { date: '30-10-2026', nav: '125.12345' },
  { date: '29-10-2026', nav: '124.98765' },
  { date: '28-10-2026', nav: '124.50000' },
];

test('parses MFAPI dates in DD-MM-YYYY format', () => {
  assert.equal(parseMfApiDate('03-02-2026'), '2026-02-03');
  assert.equal(parseMfApiDate('31-02-2026'), null);
  assert.equal(parseMfApiDate('2026-02-03'), null);
});

test('uses the exact published NAV for the selected business date', () => {
  assert.deepEqual(resolveHistoricalMutualFundNav(sample, '2026-10-29'), {
    date: '2026-10-29', nav: 124.98765, matchType: 'exact',
  });
});

test('uses the next published NAV when the selected transaction date has no NAV (weekend or holiday)', () => {
  assert.deepEqual(resolveHistoricalMutualFundNav(sample, '2026-10-31'), {
    date: '2026-10-30', nav: 125.12345, matchType: 'latest_available',
  });
});

test('uses the latest available NAV as a provisional reference when selected date is recent and NAV is not yet published', () => {
  assert.deepEqual(resolveHistoricalMutualFundNav(sample, '2026-11-01'), {
    date: '2026-10-30', nav: 125.12345, matchType: 'latest_available',
  });
});

test('selects the next NAV for a past non-business day when that next NAV is present', () => {
  const records = [
    { date: '26-10-2026', nav: '120.00' },
    { date: '27-10-2026', nav: '121.00' },
    { date: '30-10-2026', nav: '125.00' },
  ];
  assert.deepEqual(resolveHistoricalMutualFundNav(records, '2026-10-28'), {
    date: '2026-10-30', nav: 125, matchType: 'next_available',
  });
});

test('ignores invalid NAV values and fails when no nearby NAV exists', () => {
  assert.throws(
    () => resolveHistoricalMutualFundNav([{ date: '30-10-2026', nav: '0' }], '2026-10-30'),
    /No valid historical NAV/,
  );
  assert.throws(
    () => resolveHistoricalMutualFundNav([{ date: '01-10-2026', nav: '100' }], '2026-10-30'),
    /within 7 days/,
  );
});
