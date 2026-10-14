// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { REGISTRY_KEY, createNoopRegistry, getRegistry } from '../../src/core/registry';
import type { MachineHandle } from '../../src/core/types';
import { VERSION } from '../../src/core/version';

const handle: MachineHandle = {
  machineId: 'checkout',
  instanceId: '1',
  adapter: 'fake',
  capabilities: { preview: true, live: false, children: false },
  describe: () => [{ id: 'idle', key: 'idle', type: 'atomic', children: [] }],
  getActiveLeaves: () => ['idle'],
  getContext: () => ({}),
  subscribe: () => () => {},
  normalizeTarget: (leaves) => leaves,
};

let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  const warnings = warn.mock.calls;
  const errors = error.mock.calls;
  vi.restoreAllMocks();
  expect(warnings).toEqual([]);
  expect(errors).toEqual([]);
});

describe('getRegistry on the server', () => {
  test('runs without a DOM', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  test('returns one no-op registry without setting globalThis', () => {
    const registry = getRegistry();

    expect(getRegistry()).toBe(registry);
    expect(registry.version).toBe(VERSION);
    expect(REGISTRY_KEY in globalThis).toBe(false);
  });

  test('ignores a registry already on globalThis, so requests never share one', () => {
    const shared = { ...createNoopRegistry(), version: 'shared' };
    Object.assign(globalThis, { [REGISTRY_KEY]: shared });
    try {
      expect(getRegistry()).not.toBe(shared);
    } finally {
      Reflect.deleteProperty(globalThis, REGISTRY_KEY);
    }
  });

  test('has a stable, empty, frozen snapshot', () => {
    const snapshot = getRegistry().getSnapshot();

    expect(getRegistry().getSnapshot()).toBe(snapshot);
    expect(createNoopRegistry().getSnapshot()).toBe(snapshot);
    expect(snapshot).toEqual({ machines: [], overrides: {}, log: [], data: {} });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.machines)).toBe(true);
    expect(Object.isFrozen(snapshot.overrides)).toBe(true);
    expect(Object.isFrozen(snapshot.log)).toBe(true);
    expect(Object.isFrozen(snapshot.data)).toBe(true);
  });

  test('every method is safe to call and changes nothing', async () => {
    const registry = getRegistry();
    const snapshot = registry.getSnapshot();
    const listener = vi.fn();
    const overrideListener = vi.fn();

    const unsubscribe = registry.subscribe(listener);
    const offOverride = registry.onOverride('checkout#1', overrideListener);
    const unregister = registry.register(handle);
    registry.preview('checkout#1', { leaves: ['idle'], source: 'live' });
    registry.record('checkout#1', ['idle'], { count: 1 });
    registry.registerFixtures([{ machineId: 'checkout', states: { idle: { context: {} } } }]);
    registry.logEvent({ instanceKey: 'checkout#1', event: { type: 'GO' }, leaves: ['idle'], blocked: true, at: 0 });
    registry.release('checkout#1');
    registry.release();
    registry.clearLog();
    expect(registry.getOverride('checkout#1')).toBeUndefined();
    unregister();
    offOverride();
    unsubscribe();

    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
    expect(overrideListener).not.toHaveBeenCalled();
    expect(registry.getSnapshot()).toBe(snapshot);
    expect(REGISTRY_KEY in globalThis).toBe(false);
  });
});
