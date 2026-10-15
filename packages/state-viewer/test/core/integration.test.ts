// The core modules working together: the registry with its real recording, fixture and event-log stores,
// sessionStorage-like storage shared across page loads, and deep links driving previews.
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { readDeepLink, writeDeepLink } from '../../src/core/deep-link';
import { STORAGE_PREFIX } from '../../src/core/recording';
import { createRegistry, toInstanceKey, type RegistryOptions } from '../../src/core/registry';
import type { MachineHandle, Registry, StateNodeInfo, StateNodeType } from '../../src/core/types';

function node(id: string, type: StateNodeType, children: StateNodeInfo[] = []): StateNodeInfo {
  return { id, key: id.slice(id.lastIndexOf('.') + 1), type, children };
}

const CHECKOUT_TREE: StateNodeInfo[] = [
  node('browsing', 'atomic'),
  node('paying', 'parallel', [
    node('paying.card', 'compound', [node('paying.card.idle', 'atomic'), node('paying.card.error', 'atomic')]),
    node('paying.shipping', 'compound', [
      node('paying.shipping.standard', 'atomic'),
      node('paying.shipping.express', 'atomic'),
    ]),
  ]),
  node('done', 'final'),
];

const CART_TREE: StateNodeInfo[] = [node('empty', 'atomic'), node('filled', 'atomic')];

/** Fills an untouched parallel region with the actor's current leaf there, as the XState adapter does. */
function fillRegions(target: string[], current: string[]): string[] {
  const result = [...target];
  if (!result.some((leaf) => leaf.startsWith('paying.'))) return result;
  for (const region of ['paying.card.', 'paying.shipping.']) {
    if (result.some((leaf) => leaf.startsWith(region))) continue;
    const leaf = current.find((candidate) => candidate.startsWith(region));
    if (leaf) result.push(leaf);
  }
  return result;
}

function handle(
  machineId: string,
  instanceId: string,
  tree: StateNodeInfo[],
  current: string[],
  source?: unknown,
): MachineHandle {
  return {
    machineId,
    instanceId,
    adapter: 'fake',
    source,
    capabilities: { preview: true, live: false, children: false },
    describe: () => tree,
    getActiveLeaves: () => current,
    getContext: () => ({ from: 'live', instanceId }),
    subscribe: () => () => {},
    normalizeTarget: (target) => fillRegions(target, current),
  };
}

function createStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

let storage: Storage;
let time: number;
let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;

function pageLoad(options: RegistryOptions = {}): Registry {
  return createRegistry({ recording: { storage }, flushOnPageHide: false, now: () => ++time, ...options });
}

/** Lets queued microtasks run, including flushes scheduled by other flushes. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  storage = createStorage();
  time = 0;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  const warnings = warn.mock.calls;
  const errors = error.mock.calls;
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Nothing in these flows should warn.
  expect(warnings).toEqual([]);
  expect(errors).toEqual([]);
});

describe('core integration', () => {
  test('recordings written by one page load mark leaves and feed previews in the next', async () => {
    vi.useFakeTimers();
    const first = pageLoad();
    const unregister = first.register(handle('checkout', '1', CHECKOUT_TREE, ['browsing']));
    first.record('checkout#1', ['paying.shipping.express', 'paying.card.error'], { attempt: 3, retry() {} });
    // A Date can't round-trip through JSON, so this configuration stays in memory only.
    first.record('checkout#1', ['done'], { finishedAt: new Date(0) });
    vi.advanceTimersByTime(500);
    unregister();
    vi.useRealTimers();

    const stored = JSON.parse(storage.getItem(`${STORAGE_PREFIX}checkout`) ?? 'null');
    expect(stored).toEqual({
      v: 1,
      entries: [{ leaves: ['paying.card.error', 'paying.shipping.express'], at: 1, context: { attempt: 3 } }],
    });

    const second = pageLoad();
    const listener = vi.fn();
    second.subscribe(listener);
    second.register(handle('checkout', '7', CHECKOUT_TREE, ['paying.card.idle', 'paying.shipping.standard']));
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
    expect([...second.getSnapshot().data.checkout.recorded].sort()).toEqual([
      'paying.card.error',
      'paying.shipping.express',
    ]);

    // The requested leaf finds the stored configuration even though normalization filled in another region.
    second.preview('checkout#7', { leaves: ['paying.card.error'] });
    expect(second.getOverride('checkout#7')).toMatchObject({
      requested: ['paying.card.error'],
      leaves: ['paying.card.error', 'paying.shipping.standard'],
      source: 'recorded',
      context: { attempt: 3 },
    });
  });

  test('a deep link previews every instance of each machine, following the normal resolution order', async () => {
    const checkout = { definition: 'checkout' };
    const registry = pageLoad();
    // Fixtures written with defineFixtures match the machine object even under another id (debug.id).
    registry.registerFixtures([
      { machineId: 'checkout-machine', source: checkout, states: { 'paying.card.error': { context: { fixture: 1 } } } },
    ]);
    const current = ['paying.card.idle', 'paying.shipping.standard'];
    registry.register(handle('checkout', 'a', CHECKOUT_TREE, current, checkout));
    registry.register(handle('checkout', 'b', CHECKOUT_TREE, ['browsing'], checkout));
    registry.register(handle('cart', 'a', CART_TREE, ['filled']));
    registry.record('cart#a', ['empty'], { items: [] });
    await settle();

    const search = writeDeepLink('?tab=2', [
      { machineId: 'checkout', leaves: ['paying.card.error', 'paying.shipping.express'] },
      { machineId: 'cart', leaves: ['empty'] },
    ]);
    expect(search).toBe('?tab=2&debug-state=checkout:paying.card.error;paying.shipping.express,cart:empty');

    const listener = vi.fn();
    registry.subscribe(listener);
    for (const target of readDeepLink(search)) {
      for (const machine of registry.getSnapshot().machines) {
        if (machine.machineId !== target.machineId) continue;
        registry.preview(toInstanceKey(machine.machineId, machine.instanceId), { leaves: target.leaves });
      }
    }

    const { overrides } = registry.getSnapshot();
    expect(Object.keys(overrides)).toEqual(['checkout#a', 'checkout#b', 'cart#a']);
    for (const key of ['checkout#a', 'checkout#b']) {
      expect(overrides[key]).toMatchObject({
        requested: ['paying.card.error', 'paying.shipping.express'],
        leaves: ['paying.card.error', 'paying.shipping.express'],
        source: 'fixture',
        context: { fixture: 1 },
      });
    }
    expect(overrides['cart#a']).toMatchObject({ leaves: ['empty'], source: 'recorded', context: { items: [] } });
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);

    const blocked = {
      instanceKey: 'cart#a',
      event: { type: 'ADD_ITEM' },
      leaves: ['empty'],
      blocked: true,
      at: 99,
    };
    registry.logEvent(blocked);
    registry.release();
    await settle();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(registry.getSnapshot().overrides).toEqual({});
    expect(registry.getSnapshot().log).toEqual([blocked]);
  });

  test('a link copied from a preview reproduces it after a reload, whatever order normalizeTarget returns', () => {
    const states = {
      'paying.card.idle': { context: { fixture: 'idle' } },
      'paying.shipping.express': { context: { fixture: 'express' } },
    };
    const load = (current: string[]) => {
      const registry = pageLoad();
      registry.registerFixtures([{ machineId: 'checkout', states }]);
      // Document order (alphabetical here), as an adapter that converts through a state value returns it.
      const normalizeTarget = (target: string[]) => fillRegions(target, current).sort();
      registry.register({ ...handle('checkout', 'a', CHECKOUT_TREE, current), normalizeTarget });
      return registry;
    };

    const first = load(['paying.card.idle', 'paying.shipping.standard']);
    first.preview('checkout#a', { leaves: ['paying.shipping.express'] });
    const override = first.getOverride('checkout#a');
    expect(override).toMatchObject({
      requested: ['paying.shipping.express'],
      leaves: ['paying.shipping.express', 'paying.card.idle'],
      context: { fixture: 'express' },
    });
    // Copy link writes the requested leaves.
    const search = writeDeepLink('', [{ machineId: 'checkout', leaves: [...(override?.requested ?? [])] }]);

    // The untouched region follows the instance's own state after the reload.
    const second = load(['paying.card.error', 'paying.shipping.standard']);
    for (const target of readDeepLink(search)) second.preview(`${target.machineId}#a`, { leaves: target.leaves });
    expect(second.getOverride('checkout#a')).toMatchObject({
      requested: override?.requested,
      leaves: ['paying.shipping.express', 'paying.card.error'],
      context: { fixture: 'express' },
    });
  });

  test('a deep link applied before lazy fixtures load moves to them, and they survive HMR under debug.id', async () => {
    const machine = { id: 'checkout' };
    const current = ['paying.card.idle', 'paying.shipping.standard'];
    const registry = pageLoad();
    // debug.id registers the machine under another id than the one its fixtures carry.
    const unregister = registry.register(handle('checkout-v2', 'a', CHECKOUT_TREE, current, machine));
    for (const target of readDeepLink('?debug-state=checkout-v2:paying.card.error')) {
      registry.preview(`${target.machineId}#a`, { leaves: target.leaves });
    }
    expect(registry.getOverride('checkout-v2#a')?.source).toBe('live');
    // The one warning in these flows: nothing has context for the link yet.
    expect(warn.mock.calls).toEqual([[expect.stringMatching(/^\[state-viewer\] No recorded or fixture context/)]]);
    warn.mockClear();
    const overrideListener = vi.fn();
    registry.onOverride('checkout-v2#a', overrideListener);

    const declined = { fixture: 'declined' };
    registry.registerFixtures([
      { machineId: 'checkout', source: machine, states: { 'paying.card.error': { context: declined } } },
    ]);
    expect(registry.getOverride('checkout-v2#a')).toMatchObject({
      requested: ['paying.card.error'],
      leaves: ['paying.card.error', 'paying.shipping.standard'],
      source: 'fixture',
      context: declined,
    });
    expect(overrideListener).toHaveBeenCalledTimes(1);

    // HMR recreates the machine object without evaluating the fixtures module again.
    unregister();
    registry.register(handle('checkout-v2', 'a', CHECKOUT_TREE, current, { id: 'checkout' }));
    await settle();
    expect([...registry.getSnapshot().data['checkout-v2'].fixture]).toEqual(['paying.card.error']);
    registry.preview('checkout-v2#a', { leaves: ['paying.card.error'] });
    expect(registry.getOverride('checkout-v2#a')).toMatchObject({ source: 'fixture', context: declined });
  });
});
