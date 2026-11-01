import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveHistoricalClose } from '../supabase/functions/_shared/stockHistory.ts';

const sampleSeries = {
  '2026-10-30': { '4. close': '1163.55' },
  '2026-10-22': { '4. close': '1176.00' },
  '2026-10-21': { '4. close': '1207.30' },
  '2026-10-19': { '4. close': '1210.00' },
};

test('uses the exact closing price when the selected date was a trading day', () => {
  assert.deepEqual(resolveHistoricalClose(sampleSeries, '2026-10-21'), {
    date: '2026-10-21', price: 1207.3, matchType: 'exact',
  });
});

test('uses the next trading session for a past weekend or market holiday', () => {
  assert.deepEqual(resolveHistoricalClose(sampleSeries, '2026-10-20'), {
    date: '2026-10-21', price: 1207.3, matchType: 'next_trading_day',
  });
});

test('uses the latest previous close when no future session is available yet', () => {
  assert.deepEqual(resolveHistoricalClose(sampleSeries, '2026-11-01'), {
    date: '2026-10-30', price: 1163.55, matchType: 'previous_close',
  });
});

test('fails clearly when the provider has no nearby trading date', () => {
  assert.throws(
    () => resolveHistoricalClose({ '2026-09-01': { '4. close': '100' } }, '2026-10-21'),
    /within seven days/,
  );
});

test('rejects invalid or missing closing prices', () => {
  assert.throws(
    () => resolveHistoricalClose({ '2026-10-21': { '4. close': '0' } }, '2026-10-21'),
    /invalid/,
  );
});


test('explains when the requested date predates the returned provider history', () => {
  assert.throws(
    () => resolveHistoricalClose({ '2026-10-30': { '4. close': '1163.55' } }, '2026-01-01'),
    /older than the historical prices available/,
  );
});
