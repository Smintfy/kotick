// The core modules working together: the registry with its real recording, fixture and event-log stores,
// sessionStorage-like storage shared across page loads, and deep links driving previews.
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { STORAGE_PREFIX } from '../../src/core/recording';
import { createRegistry, type RegistryOptions } from '../../src/core/registry';
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
});
