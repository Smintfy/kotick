import { describe, expect, test } from 'vitest';
import { createEventLog } from '../../src/core/event-log';
import type { EventLogEntry } from '../../src/core/types';

function entry(n: number): EventLogEntry {
  return { instanceKey: 'payment#1', event: { type: `E${n}` }, leaves: ['payment.error'], blocked: true, at: n };
}

function ats(entries: EventLogEntry[]): number[] {
  return entries.map((e) => e.at);
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, i) => from + i);
}

describe('createEventLog', () => {
  test('starts empty', () => {
    const log = createEventLog(5);
    expect(log.size).toBe(0);
    expect(log.toArray()).toEqual([]);
  });

  test('keeps entries oldest first below capacity', () => {
    const log = createEventLog(5);
    for (const n of [0, 1, 2]) log.push(entry(n));

    expect(log.size).toBe(3);
    expect(ats(log.toArray())).toEqual([0, 1, 2]);
  });

  test('holds exactly capacity entries, then overwrites the oldest', () => {
    const log = createEventLog(5);
    for (const n of range(0, 5)) log.push(entry(n));

    expect(log.size).toBe(5);
    expect(ats(log.toArray())).toEqual([0, 1, 2, 3, 4]);

    log.push(entry(5));
    expect(log.size).toBe(5);
    expect(ats(log.toArray())).toEqual([1, 2, 3, 4, 5]);
  });

  test('keeps the newest entries in order after several full laps', () => {
    const capacity = 4;
    const log = createEventLog(capacity);
    const total = 3 * capacity + 7;
    for (const n of range(0, total)) log.push(entry(n));

    expect(log.size).toBe(capacity);
    expect(ats(log.toArray())).toEqual([15, 16, 17, 18]);
  });

  test.each([1, 2, 3, 7])('matches the last %i pushes at every step', (capacity) => {
    const log = createEventLog(capacity);
    for (let n = 0; n < 3 * capacity + 7; n++) {
      log.push(entry(n));
      expect(log.size).toBe(Math.min(n + 1, capacity));
      expect(ats(log.toArray())).toEqual(range(Math.max(0, n + 1 - capacity), n + 1));
    }
  });

  test('defaults to a capacity of 200', () => {
    const log = createEventLog();
    for (const n of range(0, 200)) log.push(entry(n));
    expect(log.size).toBe(200);
    expect(log.toArray()[0]?.at).toBe(0);

    log.push(entry(200));
    expect(log.size).toBe(200);
    expect(ats(log.toArray())).toEqual(range(1, 201));
  });

  test('stores entries by reference', () => {
    const log = createEventLog(2);
    const first = entry(0);
    log.push(first);
    expect(log.toArray()[0]).toBe(first);
  });

  test('clear empties the log, and pushing afterwards starts a fresh buffer', () => {
    const log = createEventLog(3);
    for (const n of range(0, 5)) log.push(entry(n));

    log.clear();
    expect(log.size).toBe(0);
    expect(log.toArray()).toEqual([]);

    log.push(entry(10));
    log.push(entry(11));
    expect(log.size).toBe(2);
    expect(ats(log.toArray())).toEqual([10, 11]);

    for (const n of range(12, 15)) log.push(entry(n));
    expect(log.size).toBe(3);
    expect(ats(log.toArray())).toEqual([12, 13, 14]);
  });

  test('clear on an empty log is a no-op', () => {
    const log = createEventLog(3);
    log.clear();
    expect(log.size).toBe(0);
    log.push(entry(0));
    expect(ats(log.toArray())).toEqual([0]);
  });

  describe('toArray returns an independent array', () => {
    test.each([
      ['before wrapping', 3],
      ['after wrapping', 5],
    ])('%s', (_, pushes) => {
      const log = createEventLog(3);
      for (const n of range(0, pushes)) log.push(entry(n));
      const before = ats(log.toArray());

      const copy = log.toArray();
      expect(log.toArray()).not.toBe(copy);
      copy.reverse();
      copy.push(entry(99));
      copy.splice(0, 1);

      expect(log.size).toBe(3);
      expect(ats(log.toArray())).toEqual(before);

      log.push(entry(100));
      expect(ats(copy)).not.toContain(100);
    });
  });

  test.each([0, -1, -200, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'throws a RangeError for capacity %s',
    (capacity) => {
      expect(() => createEventLog(capacity)).toThrow(RangeError);
    },
  );

  test('names the bad capacity in the error', () => {
    expect(() => createEventLog(0)).toThrow('[state-viewer] Event log capacity must be a positive integer, got 0');
  });
});
