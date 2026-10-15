
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { STORAGE_PREFIX } from '../../src/core/recording';
import { createRegistry, type RegistryOptions } from '../../src/core/registry';
import type { MachineHandle, Registry, StateNodeInfo, StateNodeType } from '../../src/core/types';

function node(id: string, type: StateNodeType, children: StateNodeInfo[] = []): StateNodeInfo {
  return { id, key: id.slice(id.lastIndexOf('.') + 1), type, children };
}

const TREE: StateNodeInfo[] = [
  node('browsing', 'atomic'),
  node('checkout', 'parallel', [
    node('checkout.payment', 'compound', [
      node('checkout.payment.idle', 'atomic'),
      node('checkout.payment.error', 'atomic'),
      node('checkout.payment.success', 'atomic'),
    ]),
    node('checkout.shipping', 'compound', [
      node('checkout.shipping.standard', 'atomic'),
      node('checkout.shipping.express', 'atomic'),
    ]),
  ]),
  node('done', 'final'),
];

const ERROR = 'checkout.payment.error';
const IDLE = 'checkout.payment.idle';
const STANDARD = 'checkout.shipping.standard';
const EXPRESS = 'checkout.shipping.express';

function firstLeaf(state: StateNodeInfo): string {
  return state.children.length === 0 ? state.id : firstLeaf(state.children[0]);
}

/** Fills each untouched region of a targeted parallel state with its current leaf, like the XState adapter. */
function fillRegions(nodes: StateNodeInfo[], target: string[], current: string[]): string[] {
  const result = [...target];
  const within = (leaf: string, id: string) => leaf.startsWith(`${id}.`);
  const visit = (state: StateNodeInfo) => {
    if (state.type === 'parallel' && result.some((leaf) => within(leaf, state.id))) {
      for (const region of state.children) {
        if (result.some((leaf) => within(leaf, region.id))) continue;
        result.push(current.find((leaf) => within(leaf, region.id)) ?? firstLeaf(region));
      }
    }
    state.children.forEach(visit);
  };
  nodes.forEach(visit);
  return result;
}

interface FakeHandle extends MachineHandle {
  /** Current leaves of the "real" actor. */
  leaves: string[];
  /** Current context of the "real" actor. */
  context: unknown;
}

let handleCount = 0;

function fakeHandle(overrides: Partial<FakeHandle> = {}): FakeHandle {
  const handle: FakeHandle = {
    machineId: 'checkout',
    instanceId: '1',
    // Unique, so toEqual tells apart two handles registered under the same key.
    label: `handle ${++handleCount}`,
    adapter: 'fake',
    capabilities: { preview: true, live: false, children: false },
    leaves: [IDLE, STANDARD],
    context: { from: 'live' },
    describe: () => TREE,
    getActiveLeaves: () => handle.leaves,
    getContext: () => handle.context,
    subscribe: () => () => {},
    normalizeTarget: (target) => fillRegions(TREE, target, handle.leaves),
    ...overrides,
  };
  return handle;
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

let time: number;
let storage: Storage;
let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;

function setup(options: RegistryOptions = {}): Registry {
  return createRegistry({ recording: { storage }, flushOnPageHide: false, now: () => time, ...options });
}

/** Lets queued microtasks run, including flushes scheduled by other flushes. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  time = 1000;
  storage = createStorage();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  const warnings = warn.mock.calls;
  const errors = error.mock.calls;
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Each test takes the warnings it expects, so anything left over is unexpected.
  expect(warnings).toEqual([]);
  expect(errors).toEqual([]);
});

describe('preview', () => {
  test('falls back to a recording through the requested leaf after normalization added others', () => {
    const registry = setup();
    registry.register(fakeHandle({ leaves: [IDLE, STANDARD] }));
    const recorded = { from: 'recorded' };
    registry.record('checkout#1', [ERROR, EXPRESS], recorded);

    registry.preview('checkout#1', { leaves: [ERROR] });
    const override = registry.getOverride('checkout#1');
    expect(override?.leaves).toEqual([ERROR, STANDARD]);
    expect(override?.source).toBe('recorded');
    expect(override?.context).toBe(recorded);
  });
});

describe('record', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  test('ignores unknown and unregistered instance keys', async () => {
    const registry = setup();
    const handle = fakeHandle();
    const unregister = registry.register(handle);
    unregister();
    await settle();
    const listener = vi.fn();
    registry.subscribe(listener);

    registry.record('nope#1', [ERROR, STANDARD], {});
    registry.record('checkout#1', [ERROR, STANDARD], {});
    await settle();
    expect(listener).not.toHaveBeenCalled();

    registry.register(handle);
    expect(registry.getSnapshot().data.checkout.recorded.size).toBe(0);
    vi.runAllTimers();
    expect(storage.length).toBe(0);
  });

  test('a new configuration updates data.recorded and notifies', async () => {
    const registry = setup();
    registry.register(fakeHandle());
    await settle();
    const listener = vi.fn();
    registry.subscribe(listener);

    registry.record('checkout#1', [ERROR, STANDARD], { from: 'recorded' });
    expect([...registry.getSnapshot().data.checkout.recorded].sort()).toEqual([ERROR, STANDARD]);
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('re-recording a known configuration does not notify and keeps the snapshot', async () => {
    const registry = setup();
    registry.register(fakeHandle());
    registry.record('checkout#1', [ERROR, STANDARD], { attempt: 1 });
    await settle();
    const snapshot = registry.getSnapshot();
    const listener = vi.fn();
    registry.subscribe(listener);

    const latest = { attempt: 2 };
    registry.record('checkout#1', [STANDARD, ERROR], latest);
    await settle();
    expect(listener).not.toHaveBeenCalled();
    expect(registry.getSnapshot()).toBe(snapshot);

    registry.preview('checkout#1', { leaves: [ERROR] });
    expect(registry.getOverride('checkout#1')?.context).toBe(latest);
  });

  test('records under the machine id, so every instance of the machine shares recordings', () => {
    const registry = setup();
    registry.register(fakeHandle());
    registry.register(fakeHandle({ instanceId: '2' }));
    const recorded = { from: 'instance 2' };

    registry.record('checkout#2', [ERROR, STANDARD], recorded);
    registry.preview('checkout#1', { leaves: [ERROR] });
    expect(registry.getOverride('checkout#1')?.context).toBe(recorded);
  });
});

describe('flushOnPageHide', () => {
  const KEY = `${STORAGE_PREFIX}checkout`;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  function setupRecorded(): void {
    const registry = setup({ flushOnPageHide: true });
    registry.register(fakeHandle());
    registry.record('checkout#1', [ERROR, STANDARD], { from: 'recorded' });
  }

  test('writes pending recordings on pagehide before the timer fires', () => {
    setupRecorded();
    expect(storage.getItem(KEY)).toBeNull();

    window.dispatchEvent(new Event('pagehide'));
    expect(JSON.parse(storage.getItem(KEY) ?? 'null')).toEqual({
      v: 1,
      entries: [{ leaves: [ERROR, STANDARD], at: 1000, context: { from: 'recorded' } }],
    });
  });

  test('writes when the document becomes hidden, not when it becomes visible', () => {
    setupRecorded();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(storage.getItem(KEY)).toBeNull();

    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(storage.getItem(KEY)).not.toBeNull();
  });

  test('is on by default in a browser and off when disabled', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener');
    createRegistry({ recording: { storage } });
    expect(addEventListener).toHaveBeenCalledWith('pagehide', expect.any(Function));

    addEventListener.mockClear();
    setup({ flushOnPageHide: false });
    expect(addEventListener).not.toHaveBeenCalled();
  });

  test('when disabled, pagehide leaves the write to the timer', () => {
    const registry = setup();
    registry.register(fakeHandle());
    registry.record('checkout#1', [ERROR, STANDARD], {});

    window.dispatchEvent(new Event('pagehide'));
    expect(storage.getItem(KEY)).toBeNull();
    vi.runAllTimers();
    expect(storage.getItem(KEY)).not.toBeNull();
  });
});
