import { expect, test } from 'vitest';
import { formatTime, summarizePayload } from '../../src/overlay/format';

test('summarizePayload leaves out the type, and is empty without a payload', () => {
  expect(summarizePayload({ type: 'UPDATE', cardNumber: '42' })).toBe('{"cardNumber":"42"}');
  expect(summarizePayload({ type: 'RETRY' })).toBe('');
});

test('formatTime gives local hours to milliseconds', () => {
  const at = new Date(2026, 9, 14, 9, 5, 7, 42).getTime();
  expect(formatTime(at)).toBe('09:05:07.042');
  expect(formatTime(Number.NaN)).toBe('');
});
