import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createRecordingStore, type RecordedEntry } from '../../src/core/recording';

const KEY = 'state-viewer:recorded:m';

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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('hydration', () => {
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
