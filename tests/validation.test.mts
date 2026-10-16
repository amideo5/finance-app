import assert from 'node:assert/strict';
import test from 'node:test';
import { isDateKey, parsePositiveAmount, toLocalDateKey } from '../src/utils/validation.ts';

test('parsePositiveAmount accepts finite positive values', () => {
  assert.equal(parsePositiveAmount('12.50'), 12.5);
  assert.equal(parsePositiveAmount('0'), null);
  assert.equal(parsePositiveAmount('-3'), null);
  assert.equal(parsePositiveAmount('not a number'), null);
  assert.equal(parsePositiveAmount('Infinity'), null);
});

test('isDateKey rejects invalid calendar dates', () => {
  assert.equal(isDateKey('2024-02-29'), true);
  assert.equal(isDateKey('2023-02-29'), false);
  assert.equal(isDateKey('2024-13-01'), false);
  assert.equal(isDateKey('24-01-01'), false);
});

test('toLocalDateKey preserves local calendar date', () => {
  assert.equal(toLocalDateKey(new Date(2024, 1, 29, 12)), '2024-02-29');
});
