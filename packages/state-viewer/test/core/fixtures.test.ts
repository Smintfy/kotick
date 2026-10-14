import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { createFixtureStore, type FixtureStore, type FixtureTarget } from '../../src/core/fixtures';
import type { FixtureSet } from '../../src/core/types';

function fixtureSet(machineId: string, contexts: Record<string, unknown>, source?: unknown): FixtureSet {
  const states = Object.fromEntries(Object.entries(contexts).map(([leaf, context]) => [leaf, { context }]));
  return source === undefined ? { machineId, states } : { machineId, source, states };
}

function leavesOf(store: FixtureStore, target: FixtureTarget): string[] {
  return [...store.fixtureLeaves(target)].sort();
}

function contextOf(store: FixtureStore, target: FixtureTarget, leaf: string): unknown {
  return store.lookup(target, [leaf], [])?.context;
}

describe('matching', () => {
  test('matches sets by machine id', () => {
    const store = createFixtureStore();
    store.register([fixtureSet('checkout', { 'payment.error': 1 }), fixtureSet('cart', { empty: 2 })]);

    expect(leavesOf(store, { machineId: 'checkout' })).toEqual(['payment.error']);
    expect(store.lookup({ machineId: 'checkout' }, ['payment.error'], [])).toEqual({
      leaf: 'payment.error',
      context: 1,
    });
    expect(leavesOf(store, { machineId: 'other' })).toEqual([]);
  });

  test('matches by source when the handle id differs from the set id', () => {
    const machine = {};
    const generated = {};
    const store = createFixtureStore();
    store.register([
      fixtureSet('checkout', { idle: 'debug' }, machine),
      fixtureSet('(machine)', { idle: 'gen' }, generated),
    ]);

    // debug.id renamed the handle; the set still carries machine.id.
    expect(contextOf(store, { machineId: 'checkout-debug', source: machine }, 'idle')).toBe('debug');
    // A machine left on XState's default id gets a generated fallback id on its handle.
    expect(contextOf(store, { machineId: 'machine-1', source: generated }, 'idle')).toBe('gen');
  });

  test('source-matched sets win over sets that only match by id', () => {
    const machine = {};
    const store = createFixtureStore();
    store.register([
      fixtureSet('checkout', { idle: 'by id', done: 'by id' }),
      fixtureSet('checkout', { idle: 'by source' }, machine),
    ]);

    const target = { machineId: 'checkout', source: machine };
    expect(leavesOf(store, target)).toEqual(['idle']);
    expect(contextOf(store, target, 'idle')).toBe('by source');
    expect(store.lookup(target, ['done'], [])).toBeUndefined();
  });

  test('of two machines sharing an id, only the one with its own sets matches by source', () => {
    const first = {};
    const second = {};
    const store = createFixtureStore();
    store.register([fixtureSet('form', { idle: 'first' }, first), fixtureSet('form', { done: 'shared' })]);

    expect(leavesOf(store, { machineId: 'form', source: first })).toEqual(['idle']);
    // No set carries `second`, so it falls back to every set registered under the id.
    expect(leavesOf(store, { machineId: 'form', source: second })).toEqual(['done', 'idle']);
  });

  test('falls back to the machine id after HMR recreates the machine object', () => {
    const before = {};
    const after = {};
    const store = createFixtureStore();
    store.register([fixtureSet('checkout', { 'payment.error': 'declined' }, before)]);

    expect(contextOf(store, { machineId: 'checkout', source: after }, 'payment.error')).toBe('declined');
  });

  test('keeps the sets that matched by source after HMR recreates a machine registered under debug.id', () => {
    const before = {};
    const after = {};
    const store = createFixtureStore();
    store.register([fixtureSet('checkout', { 'payment.error': 'declined' }, before)]);
    // What the registry does when the handle registers; nothing has looked a fixture up yet.
    expect(leavesOf(store, { machineId: 'checkout-v2', source: before })).toEqual(['payment.error']);
    // Registering again, even sets for other machines, keeps what was learned.
    store.register([fixtureSet('cart', { empty: 1 })]);

    const target = { machineId: 'checkout-v2', source: after };
    expect(contextOf(store, target, 'payment.error')).toBe('declined');
    expect(leavesOf(store, target)).toEqual(['payment.error']);
  });

  test('only falls back to sets of another id once a source matched for that machine id', () => {
    const machine = {};
    const store = createFixtureStore();
    store.register([fixtureSet('checkout', { 'payment.error': 'declined' }, machine)]);

    expect(leavesOf(store, { machineId: 'checkout-v2', source: {} })).toEqual([]);
    store.fixtureLeaves({ machineId: 'checkout-v2', source: machine });
    expect(leavesOf(store, { machineId: 'checkout-v2', source: {} })).toEqual(['payment.error']);
    expect(leavesOf(store, { machineId: 'checkout-v3', source: {} })).toEqual([]);
  });

  test('records the alias of a second id for a machine object whose sets were already matched', () => {
    const machine = {};
    const store = createFixtureStore();
    store.register([fixtureSet('checkout', { 'payment.error': 'declined' }, machine)]);
    store.fixtureLeaves({ machineId: 'checkout', source: machine });
    // debug.id is per hook call, so the same machine object can register under another id, which hits the cache.
    store.fixtureLeaves({ machineId: 'checkout-mini', source: machine });

    const target = { machineId: 'checkout-mini', source: {} };
    expect(leavesOf(store, target)).toEqual(['payment.error']);
    expect(contextOf(store, target, 'payment.error')).toBe('declined');
  });

  test("machines on XState's default id with distinct generated ids never share sets", () => {
    const first = {};
    const second = {};
    const store = createFixtureStore();
    store.register([
      fixtureSet('(machine)', { idle: 'first' }, first),
      fixtureSet('(machine)', { idle: 'second', done: 'second' }, second),
    ]);
    expect(contextOf(store, { machineId: 'machine-1', source: first }, 'idle')).toBe('first');
    expect(contextOf(store, { machineId: 'machine-2', source: second }, 'idle')).toBe('second');

    // After HMR recreates both machine objects.
    expect(leavesOf(store, { machineId: 'machine-1', source: {} })).toEqual(['idle']);
    expect(contextOf(store, { machineId: 'machine-1', source: {} }, 'idle')).toBe('first');
    expect(leavesOf(store, { machineId: 'machine-2', source: {} })).toEqual(['done', 'idle']);
    expect(contextOf(store, { machineId: 'machine-2', source: {} }, 'idle')).toBe('second');
  });

  test('never matches by source when the target or the set has none', () => {
    const machine = {};
    const store = createFixtureStore();
    store.register([fixtureSet('a', { idle: 1 }, machine), fixtureSet('b', { idle: 2 }, null)]);

    expect(leavesOf(store, { machineId: 'other' })).toEqual([]);
    expect(leavesOf(store, { machineId: 'other', source: null })).toEqual([]);
  });
});

describe('merging', () => {
  test('a later set wins per leaf and earlier sets keep their other leaves', () => {
    const store = createFixtureStore();
    store.register([fixtureSet('checkout', { idle: 'first', 'payment.error': 'first' })]);
    store.register([fixtureSet('checkout', { 'payment.error': 'second', done: 'second' })]);
    store.register([fixtureSet('checkout', { done: 'third' })]);

    const target = { machineId: 'checkout' };
    expect(leavesOf(store, target)).toEqual(['done', 'idle', 'payment.error']);
    expect(contextOf(store, target, 'idle')).toBe('first');
    expect(contextOf(store, target, 'payment.error')).toBe('second');
    expect(contextOf(store, target, 'done')).toBe('third');
  });
});

describe('lookup', () => {
  const target = { machineId: 'checkout' };
  let store: FixtureStore;

  beforeEach(() => {
    store = createFixtureStore();
    store.register([fixtureSet('checkout', { 'payment.error': 'a', 'shipping.express': 'b', 'gift.on': 'c' })]);
  });

  test('checks requested leaves in the order given', () => {
    expect(store.lookup(target, ['shipping.express', 'payment.error'], [])?.leaf).toBe('shipping.express');
    expect(store.lookup(target, ['payment.error', 'shipping.express'], [])?.leaf).toBe('payment.error');
  });

  test('prefers any requested leaf over a normalized leaf listed first', () => {
    const normalized = ['payment.error', 'gift.on', 'shipping.express'];
    expect(store.lookup(target, ['shipping.express'], normalized)).toEqual({ leaf: 'shipping.express', context: 'b' });
  });

  test('falls back to the remaining normalized leaves in order', () => {
    const normalized = ['payment.idle', 'gift.on', 'shipping.express'];
    expect(store.lookup(target, ['payment.idle'], normalized)).toEqual({ leaf: 'gift.on', context: 'c' });
  });

  test('returns undefined when no leaf has a fixture', () => {
    expect(store.lookup(target, ['payment.idle'], ['payment.idle', 'shipping.standard'])).toBeUndefined();
    expect(store.lookup(target, ['toString', 'constructor'], ['__proto__'])).toBeUndefined();
    expect(store.lookup({ machineId: 'cart' }, ['payment.error'], [])).toBeUndefined();
  });

  test('returns the fixture context object itself', () => {
    const context = { items: [{ id: 'sku_1' }] };
    store.register([fixtureSet('checkout', { 'payment.error': context })]);

    expect(store.lookup(target, ['payment.error'], [])?.context).toBe(context);
  });
});

describe('register', () => {
  test('copies states so later changes to the caller object have no effect', () => {
    const original = { total: 1 };
    const states: Record<string, { context: unknown }> = { idle: { context: original }, done: { context: 2 } };
    const store = createFixtureStore();
    store.register([{ machineId: 'checkout', states }]);

    states.extra = { context: 3 };
    delete states.done;
    states.idle.context = { total: 99 };

    const target = { machineId: 'checkout' };
    expect(leavesOf(store, target)).toEqual(['done', 'idle']);
    expect(contextOf(store, target, 'idle')).toBe(original);
  });

  describe('validation', () => {
    let warn: MockInstance<typeof console.warn>;

    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warn.mockRestore();
    });

    test('warns about and skips invalid sets and entries while registering valid ones', () => {
      const store = createFixtureStore();
      const sets = [
        null,
        'checkout',
        { machineId: '', states: {} },
        { states: { idle: { context: 1 } } },
        { machineId: 'checkout', states: 'idle' },
        { machineId: 'checkout', states: null },
        {
          machineId: 'checkout',
          states: {
            idle: { context: 1 },
            empty: { context: undefined },
            bare: 'idle',
            missing: { ctx: 1 },
            inherited: Object.create({ context: 1 }),
          },
        },
        { machineId: 'cart', states: { open: { context: 2 } } },
      ];
      store.register(sets as unknown as FixtureSet[]);

      expect(warn).toHaveBeenCalledTimes(9);
      for (const [message] of warn.mock.calls) expect(message).toMatch(/^\[state-viewer\] /);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('fixture set at index 0'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('fixture set at index 1'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('fixture set at index 2: machineId'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('fixture set at index 3: machineId'));
      expect(warn.mock.calls.filter(([message]) => String(message).includes('"checkout": states'))).toHaveLength(2);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('fixture "bare" for "checkout"'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('fixture "missing" for "checkout"'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('fixture "inherited" for "checkout"'));

      expect(leavesOf(store, { machineId: 'checkout' })).toEqual(['empty', 'idle']);
      expect(store.lookup({ machineId: 'checkout' }, ['empty'], [])).toEqual({ leaf: 'empty', context: undefined });
      expect(leavesOf(store, { machineId: 'cart' })).toEqual(['open']);
    });

    test('warns about input that is not an array', () => {
      const store = createFixtureStore();
      store.register(fixtureSet('checkout', { idle: 1 }) as unknown as FixtureSet[]);

      expect(warn).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[state-viewer\] .*array/));
      expect(leavesOf(store, { machineId: 'checkout' })).toEqual([]);
    });

    test('keeps cached leaf sets when nothing valid was registered', () => {
      const store = createFixtureStore();
      store.register([fixtureSet('checkout', { idle: 1 })]);
      const before = store.fixtureLeaves({ machineId: 'checkout' });

      store.register([{ machineId: '' } as unknown as FixtureSet]);

      expect(warn).toHaveBeenCalledOnce();
      expect(store.fixtureLeaves({ machineId: 'checkout' })).toBe(before);
    });
  });
});

describe('fixtureLeaves', () => {
  test('returns the same Set for fresh target objects until register() runs again', () => {
    const machine = {};
    const store = createFixtureStore();
    store.register([fixtureSet('checkout', { idle: 1 }, machine), fixtureSet('cart', { open: 2 })]);

    const bySource = store.fixtureLeaves({ machineId: 'checkout-debug', source: machine });
    const byId = store.fixtureLeaves({ machineId: 'cart', source: {} });
    expect(store.fixtureLeaves({ machineId: 'checkout-debug', source: machine })).toBe(bySource);
    expect(store.fixtureLeaves({ machineId: 'cart', source: {} })).toBe(byId);
    expect(store.fixtureLeaves({ machineId: 'cart' })).toBe(byId);

    store.register([fixtureSet('checkout', { done: 3 }, machine)]);

    const next = store.fixtureLeaves({ machineId: 'checkout-debug', source: machine });
    expect(next).not.toBe(bySource);
    expect([...next].sort()).toEqual(['done', 'idle']);
    expect(store.fixtureLeaves({ machineId: 'checkout-debug', source: machine })).toBe(next);
  });

  test('returns a new Set for the id fallback when a new alias adds sets, and only then', () => {
    const machine = {};
    const store = createFixtureStore();
    store.register([fixtureSet('checkout', { idle: 1 }, machine), fixtureSet('checkout-v2', { done: 2 })]);
    const target = { machineId: 'checkout-v2', source: {} };

    const before = store.fixtureLeaves(target);
    expect([...before]).toEqual(['done']);
    expect(store.fixtureLeaves({ ...target })).toBe(before);

    store.fixtureLeaves({ machineId: 'checkout-v2', source: machine });
    const after = store.fixtureLeaves(target);
    expect(after).not.toBe(before);
    expect([...after].sort()).toEqual(['done', 'idle']);

    // The alias is known now, so matching by source again leaves the Set alone.
    store.fixtureLeaves({ machineId: 'checkout-v2', source: machine });
    expect(store.fixtureLeaves(target)).toBe(after);
  });

  test('returns one shared empty Set for targets without fixtures', () => {
    const store = createFixtureStore();
    const empty = store.fixtureLeaves({ machineId: 'checkout' });
    expect(empty.size).toBe(0);
    expect(store.fixtureLeaves({ machineId: 'cart', source: {} })).toBe(empty);

    store.register([fixtureSet('checkout', { idle: 1 })]);
    expect(store.fixtureLeaves({ machineId: 'cart' })).toBe(empty);
  });
});
