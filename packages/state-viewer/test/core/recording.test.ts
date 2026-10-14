import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  STORAGE_PREFIX,
  configurationKey,
  createRecordingStore,
  serializeContext,
  type RecordedEntry,
  type RecordingStoreOptions,
} from '../../src/core/recording';

const KEY = 'state-viewer:recorded:m';

function createStorage(quota = Infinity): Storage {
  const data = new Map<string, string>();
  const usedWithout = (excluded: string) => {
    let used = 0;
    for (const [key, value] of data) if (key !== excluded) used += key.length + value.length;
    return used;
  };
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key) {
      return data.get(key) ?? null;
    },
    key(index) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key) {
      data.delete(key);
    },
    setItem(key, value) {
      if (usedWithout(key) + key.length + value.length > quota) throw new DOMException('quota', 'QuotaExceededError');
      data.set(key, value);
    },
  };
}

function createThrowingStorage(): Storage {
  const fail = (): never => {
    throw new DOMException('denied', 'SecurityError');
  };
  return {
    get length() {
      return fail();
    },
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail,
  };
}

function readPayload(storage: Storage, key = KEY): { v: number; entries: RecordedEntry[] } | null {
  const raw = storage.getItem(key);
  return raw === null ? null : JSON.parse(raw);
}

function storedLeaves(storage: Storage, machineId: string): string[][] | undefined {
  return readPayload(storage, STORAGE_PREFIX + machineId)?.entries.map((entry) => entry.leaves);
}

/** Key plus value length of every recordings key, which is what the total budget counts. */
function storedTotal(storage: Storage): number {
  let total = 0;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i) ?? '';
    if (key.startsWith(STORAGE_PREFIX)) total += key.length + (storage.getItem(key)?.length ?? 0);
  }
  return total;
}

function memoryStore(options: RecordingStoreOptions = {}) {
  return createRecordingStore({ storage: null, ...options });
}

// With now() = 0, each entry is 131 characters and a one-letter machine's key 23, so a payload of n entries
// takes 42 + 132n with its key: 3 entries fit in 500 and 4 don't.
const padded = (i: number) => ({ i, pad: 'x'.repeat(80) });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('configurationKey', () => {
  test('sorts a copy of the leaves and joins them with |', () => {
    const leaves = ['shipping.express', 'payment.error', 'cart'];
    expect(configurationKey(leaves)).toBe('cart|payment.error|shipping.express');
    expect(leaves).toEqual(['shipping.express', 'payment.error', 'cart']);
  });
});

describe('lookup', () => {
  test('returns the recorded entry with the same context object', () => {
    const store = memoryStore({ now: () => 42 });
    const context = { items: [1, 2] };
    const leaves = ['b', 'a'];
    store.record('m', leaves, context);

    const entry = store.lookup('m', ['a'], ['a', 'b']);
    expect(entry).toEqual({ leaves: ['a', 'b'], context, at: 42 });
    expect(entry?.context).toBe(context);
    expect(leaves).toEqual(['b', 'a']);
  });

  test('prefers the exact configuration over a more recent partial match', () => {
    const store = memoryStore();
    const exact = { n: 1 };
    store.record('m', ['a', 'x'], exact);
    store.record('m', ['a', 'y'], { n: 2 });
    expect(store.lookup('m', ['a'], ['x', 'a'])?.context).toBe(exact);
  });

  test('falls back to the most recent entry containing a requested leaf, in the requested order', () => {
    const store = memoryStore();
    const ax = { n: 1 };
    const by = { n: 2 };
    const az = { n: 3 };
    store.record('m', ['a', 'x'], ax);
    store.record('m', ['b', 'y'], by);
    store.record('m', ['a', 'z'], az);

    expect(store.lookup('m', ['a'], ['a', 'w'])?.context).toBe(az);
    expect(store.lookup('m', ['b', 'a'], ['a', 'b'])?.context).toBe(by);
    expect(store.lookup('m', ['q', 'a'], ['a', 'q'])?.context).toBe(az);
  });

  test('re-recording a configuration makes it the most recent', () => {
    const store = memoryStore();
    const latest = { n: 3 };
    store.record('m', ['a', 'x'], { n: 1 });
    store.record('m', ['a', 'y'], { n: 2 });
    store.record('m', ['a', 'x'], latest);

    const entry = store.lookup('m', ['a'], ['a', 'w']);
    expect(entry?.leaves).toEqual(['a', 'x']);
    expect(entry?.context).toBe(latest);
  });

  test('returns undefined when nothing matches', () => {
    const store = memoryStore();
    expect(store.lookup('unknown', ['a'], ['a'])).toBeUndefined();
    store.record('m', ['a'], {});
    expect(store.lookup('m', ['b'], ['b', 'c'])).toBeUndefined();
  });
});

describe('leaf ids containing |', () => {
  // ['a|b'] and ['a', 'b'] share the configuration key 'a|b'.
  test('a newer configuration under the same key replaces the older and updates the recorded leaves', () => {
    const onAvailabilityChange = vi.fn();
    const store = memoryStore({ onAvailabilityChange });
    store.record('m', ['a|b'], { n: 1 });
    const newer = { n: 2 };
    store.record('m', ['b', 'a'], newer);

    expect(store.recordedLeaves('m')).toEqual(new Set(['a', 'b']));
    expect(onAvailabilityChange).toHaveBeenCalledTimes(2);
    expect(store.lookup('m', ['a|b'], ['a|b'])).toBeUndefined();
    expect(store.lookup('m', ['a'], ['a', 'b'])?.context).toBe(newer);
  });

  test('hydration keeps the configuration in memory over a stored one under the same key', () => {
    const storage = createStorage();
    const first = createRecordingStore({ storage });
    first.record('m', ['a', 'b'], { from: 'storage' });
    first.flush();

    const second = createRecordingStore({ storage });
    const fresh = { from: 'memory' };
    second.record('m', ['a|b'], fresh);
    second.hydrate('m');

    expect(second.recordedLeaves('m')).toEqual(new Set(['a|b']));
    expect(second.lookup('m', ['a|b'], ['a|b'])?.context).toBe(fresh);
    expect(second.lookup('m', ['a'], ['a', 'b'])).toBeUndefined();
    second.flush();
    expect(readPayload(storage)?.entries.map((entry) => entry.leaves)).toEqual([['a|b']]);
  });
});

describe('caps and availability', () => {
  test('keeps 50 configurations per machine and evicts the oldest', () => {
    const store = memoryStore();
    for (let i = 0; i <= 50; i++) store.record('m', [`s${i}`], { i });

    expect(store.lookup('m', ['s0'], ['s0'])).toBeUndefined();
    expect(store.lookup('m', ['s1'], ['s1'])?.context).toEqual({ i: 1 });
    expect(store.lookup('m', ['s50'], ['s50'])?.context).toEqual({ i: 50 });
    expect(store.recordedLeaves('m').size).toBe(50);
    expect(store.recordedLeaves('m').has('s0')).toBe(false);
  });

  test('re-recording an old configuration protects it from eviction', () => {
    const store = memoryStore();
    for (let i = 0; i < 50; i++) store.record('m', [`s${i}`], { i });
    store.record('m', ['s0'], { i: 0 });
    store.record('m', ['s50'], { i: 50 });

    expect(store.lookup('m', ['s0'], ['s0'])).toBeDefined();
    expect(store.lookup('m', ['s1'], ['s1'])).toBeUndefined();
  });

  test('reports availability only when a leaf gains its first or loses its last recording', () => {
    const onAvailabilityChange = vi.fn();
    const store = memoryStore({ maxConfigurations: 3, onAvailabilityChange });

    store.record('m', ['a'], {});
    expect(onAvailabilityChange).toHaveBeenCalledTimes(1);
    expect(onAvailabilityChange).toHaveBeenLastCalledWith('m');
    const first = store.recordedLeaves('m');
    expect(first).toEqual(new Set(['a']));

    store.record('m', ['a'], {});
    expect(onAvailabilityChange).toHaveBeenCalledTimes(1);
    expect(store.recordedLeaves('m')).toBe(first);

    store.record('m', ['a', 'b'], {});
    store.record('m', ['c'], {});
    expect(onAvailabilityChange).toHaveBeenCalledTimes(3);
    const second = store.recordedLeaves('m');
    expect(second).not.toBe(first);
    expect(second).toEqual(new Set(['a', 'b', 'c']));

    // Evicts ['a'], but ['a', 'b'] still covers a.
    store.record('m', ['b'], {});
    expect(onAvailabilityChange).toHaveBeenCalledTimes(3);
    expect(store.recordedLeaves('m')).toBe(second);

    // Evicts ['a', 'b'], the last recording containing a.
    store.record('m', ['b', 'c'], {});
    expect(onAvailabilityChange).toHaveBeenCalledTimes(4);
    expect(store.recordedLeaves('m')).not.toBe(second);
    expect(store.recordedLeaves('m')).toEqual(new Set(['b', 'c']));
  });

  test('returns one shared empty set for unknown machines', () => {
    const store = memoryStore();
    expect(store.recordedLeaves('x').size).toBe(0);
    expect(store.recordedLeaves('x')).toBe(store.recordedLeaves('y'));
  });
});

describe('scheduling', () => {
  test('record never touches storage synchronously', () => {
    const storage = createStorage();
    const getItem = vi.spyOn(storage, 'getItem');
    const setItem = vi.spyOn(storage, 'setItem');
    const removeItem = vi.spyOn(storage, 'removeItem');
    const key = vi.spyOn(storage, 'key');
    const length = vi.spyOn(storage, 'length', 'get');
    const store = createRecordingStore({ storage });

    store.record('m', ['a'], { n: 1 });
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(key).not.toHaveBeenCalled();
    expect(length).not.toHaveBeenCalled();

    vi.advanceTimersByTime(499);
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenLastCalledWith(KEY, expect.any(String));
  });

  test('record only keeps a reference, and the write serializes the context', () => {
    const store = createRecordingStore({ storage: createStorage() });
    let reads = 0;
    store.record('m', ['a'], {
      get n() {
        reads++;
        return 1;
      },
    });
    expect(reads).toBe(0);
    vi.advanceTimersByTime(499);
    expect(reads).toBe(0);
    vi.advanceTimersByTime(1);
    expect(reads).toBeGreaterThan(0);
  });

  test('records within the delay produce one write with the latest data', () => {
    const storage = createStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const store = createRecordingStore({ storage });

    for (let i = 0; i < 5; i++) {
      store.record('m', ['a'], { i });
      vi.advanceTimersByTime(100);
    }
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(readPayload(storage)?.entries.map((entry) => entry.context)).toEqual([{ i: 4 }]);
  });

  test('a constant stream of records still writes every persistDelay', () => {
    const storage = createStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const store = createRecordingStore({ storage, persistDelay: 500 });

    for (let i = 0; i < 20; i++) {
      store.record('m', [i % 2 ? 'on' : 'off'], { i });
      vi.advanceTimersByTime(100);
    }
    expect(setItem).toHaveBeenCalledTimes(4);
  });

  test('flush writes immediately and cancels the pending write', () => {
    const storage = createStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const store = createRecordingStore({ storage });

    store.flush();
    expect(setItem).not.toHaveBeenCalled();

    store.record('m', ['a'], { n: 1 });
    store.flush();
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(readPayload(storage)?.entries).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  test('dispose cancels the pending write and stops scheduling, while memory keeps working', () => {
    const storage = createStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const store = createRecordingStore({ storage });

    store.record('m', ['a'], { n: 1 });
    store.dispose();
    vi.advanceTimersByTime(1000);
    store.record('m', ['b'], { n: 2 });
    vi.advanceTimersByTime(1000);
    expect(setItem).not.toHaveBeenCalled();
    expect(store.lookup('m', ['b'], ['b'])?.context).toEqual({ n: 2 });

    store.flush();
    expect(readPayload(storage)?.entries).toHaveLength(2);
  });
});

describe('serializeContext', () => {
  test('drops functions, including a toJSON that would replace the object', () => {
    const context = { n: 1, onDone() {}, nested: { cb: () => {} }, custom: { v: 2, toJSON: () => 'flat' } };
    expect(serializeContext(context)).toBe('{"n":1,"nested":{},"custom":{"v":2}}');
  });

  test('drops the functions of an object that only looks partly like an actor ref', () => {
    expect(serializeContext({ api: { url: '/x', send() {}, subscribe() {} } })).toBe('{"api":{"url":"/x"}}');
  });

  test('a nested Date makes the context unserializable', () => {
    expect(serializeContext({ order: { createdAt: new Date(0) } })).toBeUndefined();
  });

  class Point {
    x = 1;
  }
  class FakeActor {
    send() {}
    getSnapshot() {}
    subscribe() {}
  }
  const cycle: Record<string, unknown> = { n: 1 };
  cycle.self = cycle;
  const ref = { id: 'child', send() {}, getSnapshot() {}, subscribe() {} };
  const item = { id: 1 };
  const list = [1];

  test.each<[string, unknown]>([
    ['a Map', { value: new Map() }],
    ['a Set', { value: new Set([1]) }],
    ['a WeakMap', { value: new WeakMap() }],
    ['a RegExp', { value: /a/ }],
    ['an Error', { value: new Error('x') }],
    ['a Promise', { value: Promise.resolve() }],
    ['an ArrayBuffer', { value: new ArrayBuffer(1) }],
    ['a typed array', { value: new Uint8Array(1) }],
    ['a class instance', { value: new Point() }],
    ['NaN', { value: Number.NaN }],
    ['Infinity', { value: Number.POSITIVE_INFINITY }],
    ['-Infinity', [Number.NEGATIVE_INFINITY]],
    ['a BigInt', { value: 1n }],
    ['a symbol', { value: Symbol('x') }],
    ['a cycle', cycle],
    ['an object reached twice', { items: [item, { id: 2 }], selected: item }],
    ['an array reached twice', { a: list, nested: { b: list } }],
    [
      'a throwing getter',
      {
        get value() {
          throw new Error('nope');
        },
      },
    ],
    ['a function in an array', { list: [() => {}] }],
    ['undefined in an array', { list: [undefined] }],
    ['an actor ref held by a property', { n: 1, childRef: ref }],
    ['an actor ref deep inside objects', { order: { payment: { actor: ref } } }],
    ['a class-based actor ref', { n: 1, nested: { actor: new FakeActor() } }],
    ['an actor ref in an array', { list: [ref] }],
    ['an actor ref held by an object in an array', { children: [{ id: 'a', ref }] }],
    ['a top-level undefined', undefined],
    ['a top-level function', () => {}],
    ['a top-level actor ref', ref],
  ])('%s makes the context unserializable', (_, context) => {
    expect(serializeContext(context)).toBeUndefined();
  });

  test('serializes null-prototype objects and arrays', () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { x: 1 });
    expect(serializeContext({ bare, list: [1, 'two', null, { ok: true }, [3]] })).toBe(
      '{"bare":{"x":1},"list":[1,"two",null,{"ok":true},[3]]}',
    );
  });

  test('serializes equal objects that are separate', () => {
    expect(serializeContext({ a: { id: 1 }, b: { id: 1 }, c: [], d: [] })).toBe(
      '{"a":{"id":1},"b":{"id":1},"c":[],"d":[]}',
    );
  });

  test('rejects JSON longer than maxSize', () => {
    const context = { s: 'x'.repeat(10) };
    expect(serializeContext(context, 18)).toBe('{"s":"xxxxxxxxxx"}');
    expect(serializeContext(context, 17)).toBeUndefined();
    expect(serializeContext('x'.repeat(99_998))).toHaveLength(100_000);
    expect(serializeContext('x'.repeat(99_999))).toBeUndefined();
  });
});

describe('persisting', () => {
  test('writes under state-viewer:recorded:<machineId>', () => {
    expect(STORAGE_PREFIX).toBe('state-viewer:recorded:');
    const storage = createStorage();
    const store = createRecordingStore({ storage, now: () => 5 });
    store.record('checkout', ['cart'], { n: 1 });
    store.flush();
    expect(storage.getItem('state-viewer:recorded:checkout')).toBe(
      '{"v":1,"entries":[{"leaves":["cart"],"at":5,"context":{"n":1}}]}',
    );
  });

  test('keeps contexts that cannot be serialized in memory and out of storage', () => {
    const storage = createStorage();
    const store = createRecordingStore({ storage, now: () => 7, maxEntrySize: 20 });
    const dated = { when: new Date(0) };
    const large = { s: 'x'.repeat(20) };
    store.record('m', ['a'], dated);
    store.record('m', ['b'], { n: 1 });
    store.record('m', ['c'], large);
    store.flush();

    expect(readPayload(storage)).toEqual({ v: 1, entries: [{ leaves: ['b'], at: 7, context: { n: 1 } }] });
    expect(store.lookup('m', ['a'], ['a'])?.context).toBe(dated);
    expect(store.lookup('m', ['c'], ['c'])?.context).toBe(large);
    expect(store.recordedLeaves('m')).toEqual(new Set(['a', 'b', 'c']));
  });

  test('keeps a context holding an actor ref in memory and out of storage, while functions are only dropped', () => {
    const storage = createStorage();
    const store = createRecordingStore({ storage, now: () => 7 });
    const withRef = { n: 1, nested: { childRef: { send() {}, getSnapshot() {}, subscribe() {} } } };
    store.record('m', ['a'], withRef);
    store.record('m', ['b'], { n: 2, onDone() {} });
    store.flush();

    expect(readPayload(storage)).toEqual({ v: 1, entries: [{ leaves: ['b'], at: 7, context: { n: 2 } }] });
    expect(store.lookup('m', ['a'], ['a'])?.context).toBe(withRef);
    expect(store.recordedLeaves('m')).toEqual(new Set(['a', 'b']));

    // After a reload the preview falls back to a fixture or live context instead of a context missing its ref.
    const reloaded = createRecordingStore({ storage });
    reloaded.hydrate('m');
    expect(reloaded.lookup('m', ['a'], ['a'])).toBeUndefined();
  });

  test('keeps a context that shares an object between two places in memory, so identity survives', () => {
    const storage = createStorage();
    const store = createRecordingStore({ storage });
    const item = { id: 1 };
    const context = { items: [item, { id: 2 }], selected: item };
    store.record('m', ['a'], context);
    store.flush();

    expect(storage.getItem(KEY)).toBeNull();
    expect(store.lookup('m', ['a'], ['a'])?.context).toBe(context);
  });

  test('persists at most 100_000 characters of context JSON per entry by default', () => {
    const storage = createStorage();
    const store = createRecordingStore({ storage });
    const fits = 'x'.repeat(99_998);
    const tooLarge = 'y'.repeat(99_999);
    store.record('m', ['a'], fits);
    store.record('m', ['b'], tooLarge);
    store.flush();

    expect(readPayload(storage)?.entries.map((entry) => entry.leaves)).toEqual([['a']]);
    expect(readPayload(storage)?.entries[0]?.context).toBe(fits);
    expect(store.lookup('m', ['b'], ['b'])?.context).toBe(tooLarge);
  });

  test('removes the stored key when no entry can be persisted', () => {
    const storage = createStorage();
    storage.setItem(KEY, 'not json');
    const store = createRecordingStore({ storage });
    store.record('m', ['a'], { when: new Date(0) });
    store.flush();
    expect(storage.getItem(KEY)).toBeNull();
  });

  test('serializes an unchanged entry only once', () => {
    const storage = createStorage();
    const store = createRecordingStore({ storage });
    let reads = 0;
    store.record('m', ['a'], {
      get n() {
        reads++;
        return 1;
      },
    });
    expect(reads).toBe(0);
    store.flush();
    const afterFirstWrite = reads;
    expect(afterFirstWrite).toBeGreaterThan(0);

    store.record('m', ['b'], { n: 2 });
    store.flush();
    expect(reads).toBe(afterFirstWrite);
    expect(readPayload(storage)?.entries).toHaveLength(2);
  });

  test('a write merges recordings from an earlier page load instead of replacing them', () => {
    const storage = createStorage();
    const first = createRecordingStore({ storage });
    first.record('m', ['a'], { n: 1 });
    first.flush();

    const onAvailabilityChange = vi.fn();
    const second = createRecordingStore({ storage, onAvailabilityChange });
    second.record('m', ['b'], { n: 2 });
    second.flush();

    expect(readPayload(storage)?.entries.map((entry) => entry.context)).toEqual([{ n: 1 }, { n: 2 }]);
    expect(second.recordedLeaves('m')).toEqual(new Set(['a', 'b']));
    expect(onAvailabilityChange).toHaveBeenCalledTimes(2);
  });
});

describe('hydration', () => {
  test('restores recordings from an earlier page load', () => {
    const storage = createStorage();
    const first = createRecordingStore({ storage, now: () => 1 });
    first.record('m', ['a', 'x'], { n: 1 });
    first.record('m', ['a', 'y'], { n: 2 });
    first.flush();

    const onAvailabilityChange = vi.fn();
    const second = createRecordingStore({ storage, onAvailabilityChange });
    expect(second.recordedLeaves('m').size).toBe(0);
    second.hydrate('m');

    expect(onAvailabilityChange).toHaveBeenCalledTimes(1);
    expect(onAvailabilityChange).toHaveBeenLastCalledWith('m');
    expect(second.recordedLeaves('m')).toEqual(new Set(['a', 'x', 'y']));
    expect(second.lookup('m', ['x'], ['x', 'a'])).toEqual({ leaves: ['a', 'x'], context: { n: 1 }, at: 1 });
    expect(second.lookup('m', ['a'], ['a'])?.context).toEqual({ n: 2 });
  });

  test('memory wins, and stored recordings rank older than the ones in memory', () => {
    const storage = createStorage();
    const first = createRecordingStore({ storage });
    first.record('m', ['a', 'x'], { from: 'old-x' });
    first.record('m', ['a', 'y'], { from: 'old-y' });
    first.flush();

    const second = createRecordingStore({ storage });
    const fresh = { from: 'new-x' };
    second.record('m', ['a', 'x'], fresh);
    second.hydrate('m');

    expect(second.lookup('m', ['x'], ['a', 'x'])?.context).toBe(fresh);
    expect(second.lookup('m', ['a'], ['a', 'w'])?.context).toBe(fresh);
    expect(second.lookup('m', ['y'], ['a', 'y'])?.context).toEqual({ from: 'old-y' });

    second.flush();
    expect(readPayload(storage)?.entries.map((entry) => entry.context)).toEqual([{ from: 'old-y' }, fresh]);
  });

  test('does not report a change when storage only adds known leaves', () => {
    const storage = createStorage();
    const first = createRecordingStore({ storage });
    first.record('m', ['a'], { n: 1 });
    first.record('m', ['a', 'b'], { n: 2 });
    first.flush();

    const onAvailabilityChange = vi.fn();
    const second = createRecordingStore({ storage, onAvailabilityChange });
    second.record('m', ['a', 'b'], { n: 3 });
    const before = second.recordedLeaves('m');
    second.hydrate('m');

    expect(onAvailabilityChange).toHaveBeenCalledTimes(1);
    expect(second.recordedLeaves('m')).toBe(before);
    expect(second.lookup('m', ['a'], ['a'])?.context).toEqual({ n: 1 });
  });

  const valid = { leaves: ['a'], at: 1, context: { n: 1 } };

  test.each<[string, string]>([
    ['invalid JSON', '{"v":1,"entries":['],
    ['null', 'null'],
    ['another version', JSON.stringify({ v: 2, entries: [valid] })],
    ['entries that are not an array', JSON.stringify({ v: 1, entries: { 0: valid } })],
    ['an entry that is not an object', JSON.stringify({ v: 1, entries: [valid, null] })],
    ['leaves that are not strings', JSON.stringify({ v: 1, entries: [{ ...valid, leaves: [1] }] })],
    ['leaves that are not an array', JSON.stringify({ v: 1, entries: [{ ...valid, leaves: 'a' }] })],
    ['a timestamp that is not a number', JSON.stringify({ v: 1, entries: [{ ...valid, at: '1' }] })],
    ['a timestamp that is not finite', '{"v":1,"entries":[{"leaves":["a"],"at":1e999,"context":{}}]}'],
    ['a missing context', JSON.stringify({ v: 1, entries: [{ leaves: ['a'], at: 1 }] })],
  ])('ignores a payload with %s', (_, raw) => {
    const storage = createStorage();
    storage.setItem(KEY, raw);
    const onAvailabilityChange = vi.fn();
    const store = createRecordingStore({ storage, onAvailabilityChange });

    expect(() => store.hydrate('m')).not.toThrow();
    expect(store.recordedLeaves('m').size).toBe(0);
    expect(store.lookup('m', ['a'], ['a'])).toBeUndefined();
    expect(onAvailabilityChange).not.toHaveBeenCalled();
  });

  test('applies the cap after hydration, keeping the newest', () => {
    const storage = createStorage();
    const first = createRecordingStore({ storage });
    for (const leaf of ['s1', 's2', 's3']) first.record('m', [leaf], { leaf });
    first.flush();

    const second = createRecordingStore({ storage, maxConfigurations: 2 });
    second.record('m', ['live'], { leaf: 'live' });
    second.hydrate('m');

    expect(second.recordedLeaves('m')).toEqual(new Set(['s3', 'live']));
    expect(second.lookup('m', ['s2'], ['s2'])).toBeUndefined();
    expect(second.lookup('m', ['s3'], ['s3'])?.context).toEqual({ leaf: 's3' });
  });

  test('hydrates each machine once', () => {
    const storage = createStorage();
    const first = createRecordingStore({ storage });
    first.record('m', ['a'], {});
    first.flush();

    const onAvailabilityChange = vi.fn();
    const second = createRecordingStore({ storage, onAvailabilityChange });
    second.hydrate('m');
    first.record('m', ['b'], {});
    first.flush();
    second.hydrate('m');

    expect(second.recordedLeaves('m')).toEqual(new Set(['a']));
    expect(onAvailabilityChange).toHaveBeenCalledTimes(1);
  });

  test('does nothing when storage is null', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ v: 1, entries: [{ leaves: ['a'], at: 1, context: {} }] }));
    const onAvailabilityChange = vi.fn();
    const store = createRecordingStore({ storage: null, onAvailabilityChange });
    store.hydrate('m');
    expect(store.recordedLeaves('m').size).toBe(0);
    expect(onAvailabilityChange).not.toHaveBeenCalled();

    store.record('m', ['b'], {});
    store.flush();
    vi.advanceTimersByTime(1000);
    expect(readPayload(sessionStorage)?.entries).toHaveLength(1);
  });

  test('uses sessionStorage by default', () => {
    const store = createRecordingStore({ now: () => 3 });
    store.record('m', ['a'], { n: 1 });
    store.flush();
    expect(readPayload(sessionStorage)?.entries).toEqual([{ leaves: ['a'], at: 3, context: { n: 1 } }]);
  });

  test('keeps recordings in memory when sessionStorage is off limits', () => {
    const getter = vi.spyOn(globalThis, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const store = createRecordingStore();
    getter.mockRestore();

    const context = { n: 1 };
    store.record('m', ['a'], context);
    store.hydrate('m');
    store.flush();
    expect(store.lookup('m', ['a'], ['a'])?.context).toBe(context);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  test('survives storage whose every method throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createRecordingStore({ storage: createThrowingStorage() });
    const context = { n: 1 };

    expect(() => {
      store.hydrate('m');
      store.record('m', ['a'], context);
      vi.advanceTimersByTime(500);
      store.record('m', ['b'], {});
      store.flush();
    }).not.toThrow();
    expect(store.lookup('m', ['a'], ['a'])?.context).toBe(context);
    expect(store.recordedLeaves('m')).toEqual(new Set(['a', 'b']));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/^\[state-viewer\] /);
  });
});

describe('quota', () => {
  test('keeps the newest entries that fit and warns once per machine', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = createStorage(500);
    const store = createRecordingStore({ storage, now: () => 0 });
    for (let i = 0; i < 8; i++) store.record('m', [`s${i}`], padded(i));
    store.flush();

    expect(readPayload(storage)?.entries.map((entry) => entry.leaves)).toEqual([['s6'], ['s7']]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/^\[state-viewer\] Storage is full or unavailable, .*"m"/);

    store.record('m', ['s8'], padded(8));
    store.flush();
    expect(readPayload(storage)?.entries.map((entry) => entry.leaves)).toEqual([['s7'], ['s8']]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(store.lookup('m', ['s1'], ['s1'])?.context).toEqual(padded(1));
  });

  test('removes the stored key when not even the newest entry fits', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = createStorage(200);
    const store = createRecordingStore({ storage, now: () => 0 });
    store.record('m', ['a'], { n: 1 });
    store.flush();
    expect(storage.getItem(KEY)).not.toBeNull();

    store.record('m', ['b'], { pad: 'x'.repeat(300) });
    store.flush();
    expect(storage.getItem(KEY)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('total budget', () => {
  test('fits every machine within the budget, each with its newest entries, and warns once per machine', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = createStorage();
    const store = createRecordingStore({ storage, now: () => 0, maxTotalSize: 800 });
    for (let i = 0; i < 4; i++) {
      store.record('a', [`s${i}`], padded(i));
      store.record('b', [`s${i}`], padded(i));
    }
    store.flush();

    // a takes 570, which leaves b room for one entry.
    expect(storedLeaves(storage, 'a')).toEqual([['s0'], ['s1'], ['s2'], ['s3']]);
    expect(storedLeaves(storage, 'b')).toEqual([['s3']]);
    expect(storedTotal(storage)).toBeLessThanOrEqual(800);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/^\[state-viewer\] Recordings are limited to 800 characters .*"b"/);

    for (let i = 4; i < 6; i++) {
      store.record('a', [`s${i}`], padded(i));
      store.record('b', [`s${i}`], padded(i));
    }
    store.flush();

    // b's single entry takes 174, which leaves a room for four.
    expect(storedLeaves(storage, 'a')).toEqual([['s2'], ['s3'], ['s4'], ['s5']]);
    expect(storedLeaves(storage, 'b')).toEqual([['s5']]);
    expect(storedTotal(storage)).toBeLessThanOrEqual(800);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]?.[0]).toMatch(/^\[state-viewer\] Recordings are limited to 800 characters .*"a"/);

    store.record('a', ['s6'], padded(6));
    store.record('b', ['s6'], padded(6));
    store.flush();
    expect(storedLeaves(storage, 'a')).toEqual([['s3'], ['s4'], ['s5'], ['s6']]);
    expect(storedLeaves(storage, 'b')).toEqual([['s6']]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(store.lookup('a', ['s0'], ['s0'])?.context).toEqual(padded(0));
    expect(store.lookup('b', ['s0'], ['s0'])?.context).toEqual(padded(0));
  });

  test('counts recordings stored by an earlier page load against the budget', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = createStorage();
    const earlier = createRecordingStore({ storage, now: () => 0 });
    earlier.record('a', ['s0'], padded(0));
    earlier.record('a', ['s1'], padded(1));
    earlier.flush();

    const store = createRecordingStore({ storage, now: () => 0, maxTotalSize: 800 });
    for (let i = 0; i < 4; i++) store.record('b', [`s${i}`], padded(i));
    store.flush();

    // a still takes 306, which leaves b room for three.
    expect(storedLeaves(storage, 'a')).toEqual([['s0'], ['s1']]);
    expect(storedLeaves(storage, 'b')).toEqual([['s1'], ['s2'], ['s3']]);
    expect(storedTotal(storage)).toBeLessThanOrEqual(800);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test.each([
    [570, 4],
    [569, 3],
  ])('with maxTotalSize %i, keeps %i of four entries', (maxTotalSize, kept) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = createStorage();
    const store = createRecordingStore({ storage, now: () => 0, maxTotalSize });
    for (let i = 0; i < 4; i++) store.record('m', [`s${i}`], padded(i));
    store.flush();

    // Exactly 42 + 132n with the key and the commas between entries, so four fit a budget of 570 and not of 569.
    expect(storedLeaves(storage, 'm')).toHaveLength(kept);
    expect(storedTotal(storage)).toBe(42 + 132 * kept);
    expect(warn).toHaveBeenCalledTimes(kept < 4 ? 1 : 0);
  });

  test("counts the machine's own key length when fitting it into the budget", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = createStorage();
    const machineId = 'x'.repeat(200);
    const store = createRecordingStore({ storage, now: () => 0, maxTotalSize: 100 });
    store.record(machineId, ['a'], { n: 1 });
    store.flush();

    // The value alone is 61 characters, but its 222-character key makes it 283.
    expect(storage.getItem(STORAGE_PREFIX + machineId)).toBeNull();
    expect(storedTotal(storage)).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/^\[state-viewer\] Recordings are limited to 100 characters /);
  });

  test.each(['written by this store', 'scanned on a later page load'])(
    "counts another machine's key plus value length when %s",
    (how) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const storage = createStorage();
      const options = { storage, now: () => 0, maxTotalSize: 500 };
      const writer = createRecordingStore(options);
      const longId = 'a'.repeat(300);
      writer.record(longId, ['a'], { n: 1 });
      writer.flush();
      expect(storedTotal(storage)).toBe(383);

      const store = how === 'written by this store' ? writer : createRecordingStore(options);
      store.record('b', ['a'], { pad: 'x'.repeat(60) });
      store.flush();

      // The other machine's 322-character key and 61-character value leave 117, and b takes 147 with its key.
      expect(storedLeaves(storage, 'b')).toBeUndefined();
      expect(storedLeaves(storage, longId)).toEqual([['a']]);
      expect(storedTotal(storage)).toBe(383);
      expect(warn).toHaveBeenCalledTimes(1);
    },
  );

  test('defaults to 1,000,000 characters and can be configured', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const large = 'x'.repeat(99_000);
    const fill = (storage: Storage, options: RecordingStoreOptions = {}) => {
      const store = createRecordingStore({ storage, now: () => 0, ...options });
      for (let i = 0; i <= 10; i++) store.record('m', [`s${i}`], large);
      store.flush();
    };

    // Eleven entries of about 99,000 characters, of which the newest ten fit.
    const storage = createStorage();
    fill(storage);
    expect(storedLeaves(storage, 'm')).toHaveLength(10);
    expect(storedLeaves(storage, 'm')?.[0]).toEqual(['s1']);
    expect(storedTotal(storage)).toBeLessThanOrEqual(1_000_000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/^\[state-viewer\] Recordings are limited to 1,000,000 characters .*"m"/);

    const roomy = createStorage();
    fill(roomy, { maxTotalSize: 2_000_000 });
    expect(storedLeaves(roomy, 'm')).toHaveLength(11);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("ignores the app's own keys and never removes them", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = createStorage();
    const own = 'x'.repeat(1000);
    storage.setItem('cart', own);
    storage.setItem('state-viewer:panel', own);
    const removeItem = vi.spyOn(storage, 'removeItem');
    const store = createRecordingStore({ storage, now: () => 0, maxTotalSize: 800 });
    for (let i = 0; i < 6; i++) store.record('m', [`s${i}`], padded(i));
    store.flush();

    // Five entries take 702 of the 800; counting the app's keys would leave no room at all.
    expect(storedLeaves(storage, 'm')).toEqual([['s1'], ['s2'], ['s3'], ['s4'], ['s5']]);
    expect(storage.getItem('cart')).toBe(own);
    expect(storage.getItem('state-viewer:panel')).toBe(own);
    expect(removeItem).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('a removed key gives its share of the budget back', () => {
    const storage = createStorage();
    const store = createRecordingStore({ storage, now: () => 0, maxTotalSize: 800, maxConfigurations: 2 });
    store.record('a', ['s0'], padded(0));
    store.record('a', ['s1'], padded(1));
    store.flush();
    expect(storedLeaves(storage, 'a')).toHaveLength(2);

    // Contexts that stay in memory evict a's stored ones, so its key is removed before b is written.
    store.record('a', ['d0'], { when: new Date(0) });
    store.record('a', ['d1'], { when: new Date(1) });
    // Two of these take 734, which only fits once a's 306 are gone.
    store.record('b', ['s0'], { pad: 'x'.repeat(300) });
    store.record('b', ['s1'], { pad: 'x'.repeat(300) });
    store.flush();

    expect(storage.getItem(`${STORAGE_PREFIX}a`)).toBeNull();
    expect(storedLeaves(storage, 'b')).toEqual([['s0'], ['s1']]);
  });

  test('scans storage once, on the first write', () => {
    const storage = createStorage();
    storage.setItem('cart', '1');
    const key = vi.spyOn(storage, 'key');
    const store = createRecordingStore({ storage });
    store.record('m', ['a'], {});
    store.hydrate('m');
    expect(key).not.toHaveBeenCalled();

    store.flush();
    const scanned = key.mock.calls.length;
    expect(scanned).toBeGreaterThan(0);
    store.record('m', ['b'], {});
    store.flush();
    expect(key).toHaveBeenCalledTimes(scanned);
  });

  test('counts nothing as stored when the scan fails partway', () => {
    const storage = createStorage();
    const earlier = createRecordingStore({ storage, now: () => 0 });
    earlier.record('a', ['s0'], padded(0));
    earlier.record('a', ['s1'], padded(1));
    earlier.flush();
    storage.setItem('cart', '1');

    const keyAt = storage.key.bind(storage);
    vi.spyOn(storage, 'key').mockImplementation((index) => {
      if (index > 0) throw new DOMException('denied', 'SecurityError');
      return keyAt(index);
    });
    const store = createRecordingStore({ storage, now: () => 0, maxTotalSize: 800 });
    for (let i = 0; i < 4; i++) store.record('b', [`s${i}`], padded(i));

    expect(() => store.flush()).not.toThrow();
    // Counting a's 306 from before the failure would leave room for only three.
    expect(storedLeaves(storage, 'b')).toHaveLength(4);
  });
});
