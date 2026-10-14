import { describe, expect, test } from 'vitest';
import { createActor, createMachine } from 'xstate';
import { formatTime, inspect, summarizePayload, toJson } from '../../src/overlay/format';

describe('toJson', () => {
  test('pretty-prints plain data', () => {
    expect(toJson({ a: 1, b: ['x'] })).toBe('{\n  "a": 1,\n  "b": [\n    "x"\n  ]\n}');
  });

  test('turns what JSON can’t hold into placeholders instead of throwing', () => {
    const cycle: Record<string, unknown> = { name: 'loop' };
    cycle.self = cycle;
    const actor = createActor(createMachine({ id: 'child' }));
    const value = {
      cycle,
      fn: function save() {},
      big: 10n,
      map: new Map<unknown, unknown>([
        ['a', 1],
        [2, 'b'],
      ]),
      set: new Set([1, 2]),
      date: new Date(Date.UTC(2026, 9, 14)),
      error: new TypeError('nope'),
      actor,
      gone: undefined,
    };

    expect(JSON.parse(toJson(value))).toEqual({
      cycle: { name: 'loop', self: '[Circular]' },
      fn: '[Function save]',
      big: '10n',
      map: { a: 1, 2: 'b' },
      set: [1, 2],
      date: '2026-10-14T00:00:00.000Z',
      error: 'TypeError: nope',
      actor: `[Actor ${actor.id}]`,
    });
  });

  test('repeats a shared object that isn’t a cycle', () => {
    const shared = { n: 1 };
    expect(JSON.parse(toJson({ a: shared, b: shared }))).toEqual({ a: { n: 1 }, b: { n: 1 } });
  });

  test('survives getters that throw', () => {
    const hostile = {
      get boom() {
        throw new Error('no');
      },
    };
    expect(toJson(hostile)).toMatch(/Unserializable: no/);
  });
});

describe('inspect', () => {
  test('describes leaves with their type', () => {
    expect(inspect('hi')).toEqual({ kind: 'leaf', type: 'string', text: '"hi"' });
    expect(inspect(3)).toEqual({ kind: 'leaf', type: 'number', text: '3' });
    expect(inspect(null)).toEqual({ kind: 'leaf', type: 'null', text: 'null' });
    expect(inspect(undefined)).toEqual({ kind: 'leaf', type: 'undefined', text: 'undefined' });
    expect(inspect(() => {})).toMatchObject({ kind: 'leaf', type: 'special' });
  });

  test('describes branches with a summary and lazy entries', () => {
    const array = inspect([1, 2]);
    expect(array).toMatchObject({ kind: 'branch', summary: 'Array(2)', size: 2 });
    expect(array.kind === 'branch' && array.entries()).toEqual([
      ['0', 1],
      ['1', 2],
    ]);
    expect(inspect({})).toMatchObject({ kind: 'branch', summary: '{}', size: 0 });
    expect(inspect({ a: 1 })).toMatchObject({ kind: 'branch', summary: '{…}', size: 1 });
    expect(inspect(new Map([['k', 1]]))).toMatchObject({ kind: 'branch', summary: 'Map(1)' });
    class Point {
      x = 1;
    }
    expect(inspect(new Point())).toMatchObject({ kind: 'branch', summary: 'Point {…}' });
  });
});

test('summarizePayload leaves out the type, and is empty without a payload', () => {
  expect(summarizePayload({ type: 'UPDATE', cardNumber: '42' })).toBe('{"cardNumber":"42"}');
  expect(summarizePayload({ type: 'RETRY' })).toBe('');
});

test('formatTime gives local hours to milliseconds', () => {
  const at = new Date(2026, 9, 14, 9, 5, 7, 42).getTime();
  expect(formatTime(at)).toBe('09:05:07.042');
  expect(formatTime(Number.NaN)).toBe('');
});
