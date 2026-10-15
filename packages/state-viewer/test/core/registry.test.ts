
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { STORAGE_PREFIX } from '../../src/core/recording';
import { createRegistry, type RegistryOptions } from '../../src/core/registry';
import type { FixtureSet, MachineHandle, Registry, StateNodeInfo, StateNodeType } from '../../src/core/types';

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
const SUCCESS = 'checkout.payment.success';
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

function fixtureSet(machineId: string, contexts: Record<string, unknown>, source?: unknown): FixtureSet {
  const states = Object.fromEntries(Object.entries(contexts).map(([leaf, context]) => [leaf, { context }]));
  return { machineId, source, states };
}

let time: number;
let storage: Storage;
let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;

function setup(options: RegistryOptions = {}): Registry {
  return createRegistry({ recording: { storage }, flushOnPageHide: false, now: () => time, ...options });
}

/** Warnings logged so far, which this test therefore expects; clears them. */
function takeWarnings(): string[] {
  const messages = warn.mock.calls.map((args) => String(args[0]));
  warn.mockClear();
  return messages;
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

describe('link', () => {
  const fixture = { from: 'fixture' };
  const LIVE_WARNING = /^\[state-viewer\] No recorded or fixture context/;

  /** A registry with a fixture for ERROR, so linked previews resolve without warning. */
  function setupWithFixture(): Registry {
    const registry = setup();
    registry.registerFixtures([fixtureSet('checkout', { [ERROR]: fixture })]);
    return registry;
  }

  test('previews an instance inside its registration, so a listener set up before it hears the preview', () => {
    const registry = setupWithFixture();
    registry.link([{ machineId: 'checkout', leaves: [ERROR] }]);
    // What the XState adapter does: the proxy listens before it registers, so a deep link reaches the first paint.
    const heard = vi.fn(() => registry.getOverride('checkout#1'));
    registry.onOverride('checkout#1', heard);

    registry.register(fakeHandle());
    const override = registry.getOverride('checkout#1');
    expect(override).toMatchObject({
      requested: [ERROR],
      leaves: [ERROR, STANDARD],
      source: 'fixture',
      context: fixture,
    });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveLastReturnedWith(override);
  });

  test('previews every instance of the machine as it registers, and leaves other machines alone', () => {
    const registry = setupWithFixture();
    registry.link([{ machineId: 'checkout', leaves: [ERROR] }]);

    registry.register(fakeHandle({ instanceId: '1' }));
    registry.register(fakeHandle({ instanceId: '2' }));
    registry.register(fakeHandle({ machineId: 'cart', instanceId: '3' }));

    expect(Object.keys(registry.getSnapshot().overrides)).toEqual(['checkout#1', 'checkout#2']);
  });

  test('previews instances registered already at the next microtask, not inside link()', async () => {
    const registry = setupWithFixture();
    registry.register(fakeHandle({ instanceId: '1' }));
    const heard = vi.fn();
    registry.onOverride('checkout#1', heard);

    registry.link([{ machineId: 'checkout', leaves: [ERROR] }]);
    expect(registry.getOverride('checkout#1')).toBeUndefined();
    expect(heard).not.toHaveBeenCalled();

    // Registered between link() and the microtask: previewed as it registers, and only once.
    registry.register(fakeHandle({ instanceId: '2' }));
    const second = registry.getOverride('checkout#2');
    await settle();
    expect(registry.getOverride('checkout#1')).toMatchObject({ requested: [ERROR], source: 'fixture' });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(registry.getOverride('checkout#2')).toBe(second);
  });

  test('skips an instance unregistered before the microtask, and one that came back gets it', async () => {
    const registry = setupWithFixture();
    const unregisterGone = registry.register(fakeHandle({ instanceId: '1' }));
    const unregisterBack = registry.register(fakeHandle({ instanceId: '2' }));

    registry.link([{ machineId: 'checkout', leaves: [ERROR] }]);
    unregisterGone();
    // StrictMode and Fast Refresh run a cleanup and the setup again in the same tick.
    unregisterBack();
    registry.register(fakeHandle({ instanceId: '2' }));
    await settle();

    expect(Object.keys(registry.getSnapshot().overrides)).toEqual(['checkout#2']);
  });

  test('skips child machines, which are listed without the preview capability, without warning', async () => {
    const registry = setupWithFixture();
    registry.link([{ machineId: 'checkout', leaves: [ERROR] }]);

    registry.register(
      fakeHandle({ parentKey: 'parent#1', capabilities: { preview: false, live: false, children: false } }),
    );
    await settle();
    expect(registry.getSnapshot().overrides).toEqual({});
  });

  test('an instance that registers again before the flush keeps its preview', () => {
    const registry = setupWithFixture();
    registry.link([{ machineId: 'checkout', leaves: [ERROR] }]);
    const unregister = registry.register(fakeHandle());
    const override = registry.getOverride('checkout#1');

    unregister();
    registry.register(fakeHandle());
    expect(registry.getOverride('checkout#1')).toBe(override);
  });

  test('previews an instance that registers again after the flush released its preview', async () => {
    const registry = setupWithFixture();
    registry.link([{ machineId: 'checkout', leaves: [ERROR] }]);
    const unregister = registry.register(fakeHandle());
    // A hidden Activity unregisters its components until it's revealed.
    unregister();
    await settle();
    expect(registry.getOverride('checkout#1')).toBeUndefined();

    registry.register(fakeHandle());
    expect(registry.getOverride('checkout#1')).toMatchObject({ requested: [ERROR] });
  });

  test('ends when preview() is called for one of the machine’s instances, and only for that machine', () => {
    const registry = setupWithFixture();
    registry.link([
      { machineId: 'checkout', leaves: [ERROR] },
      { machineId: 'cart', leaves: [ERROR] },
    ]);
    registry.register(fakeHandle({ instanceId: '1' }));

    registry.preview('checkout#1', { leaves: [SUCCESS] });
    expect(takeWarnings()).toEqual([expect.stringMatching(LIVE_WARNING)]);
    registry.register(fakeHandle({ instanceId: '2' }));
    expect(registry.getOverride('checkout#1')?.requested).toEqual([SUCCESS]);
    expect(registry.getOverride('checkout#2')).toBeUndefined();

    // The fixture is for checkout, so the cart's linked preview falls back to live context.
    registry.register(fakeHandle({ machineId: 'cart', instanceId: '3' }));
    expect(registry.getOverride('cart#3')?.requested).toEqual([ERROR]);
    expect(takeWarnings()).toEqual([expect.stringMatching(LIVE_WARNING)]);
  });

  test('ends when release() is called for one of the machine’s instances', () => {
    const registry = setupWithFixture();
    registry.link([{ machineId: 'checkout', leaves: [ERROR] }]);
    const unregister = registry.register(fakeHandle({ instanceId: '1' }));

    registry.release('checkout#1');
    // Fast Refresh registers the instance again in the same tick; the released link doesn't come back.
    unregister();
    registry.register(fakeHandle({ instanceId: '1' }));
    registry.register(fakeHandle({ instanceId: '2' }));

    expect(registry.getSnapshot().overrides).toEqual({});
  });

  test('every link ends when release() releases everything', () => {
    const registry = setupWithFixture();
    registry.link([
      { machineId: 'checkout', leaves: [ERROR] },
      { machineId: 'cart', leaves: [ERROR] },
    ]);

    registry.release();
    registry.register(fakeHandle({ instanceId: '1' }));
    registry.register(fakeHandle({ machineId: 'cart', instanceId: '2' }));

    expect(registry.getSnapshot().overrides).toEqual({});
  });

  test('a preview the flush releases after an unregister doesn’t end the link', async () => {
    const registry = setupWithFixture();
    registry.link([{ machineId: 'checkout', leaves: [ERROR] }]);
    registry.register(fakeHandle({ instanceId: '1' }))();
    await settle();

    registry.register(fakeHandle({ instanceId: '2' }));
    expect(registry.getOverride('checkout#2')?.requested).toEqual([ERROR]);
  });

  test('uses the default order, so fixtures that load later move its previews to them', () => {
    const registry = setup();
    registry.link([{ machineId: 'checkout', leaves: [ERROR] }]);
    registry.register(fakeHandle({ instanceId: '1' }));
    expect(registry.getOverride('checkout#1')?.source).toBe('live');
    expect(takeWarnings()).toEqual([expect.stringMatching(LIVE_WARNING)]);

    registry.registerFixtures([fixtureSet('checkout', { [ERROR]: fixture })]);
    expect(registry.getOverride('checkout#1')).toMatchObject({ source: 'fixture', context: fixture });
  });

  test('warns for the first instance only, so a list with the same problem warns once', async () => {
    const registry = setup();
    registry.register(fakeHandle({ instanceId: '1' }));
    registry.register(fakeHandle({ instanceId: '2' }));
    registry.link([{ machineId: 'checkout', leaves: [ERROR, 'nope'] }]);
    await settle();
    registry.register(fakeHandle({ instanceId: '3' }));

    expect(takeWarnings()).toEqual([
      expect.stringMatching(/^\[state-viewer\] Ignoring "nope" in the preview of "checkout#1"/),
      expect.stringMatching(LIVE_WARNING),
    ]);
    expect(Object.keys(registry.getSnapshot().overrides)).toEqual(['checkout#1', 'checkout#2', 'checkout#3']);
  });

  test('a link that can’t preview warns once and previews nothing', async () => {
    const registry = setup();
    registry.link([{ machineId: 'checkout', leaves: ['nope'] }]);
    registry.register(fakeHandle({ instanceId: '1' }));
    registry.register(fakeHandle({ instanceId: '2' }));
    await settle();

    expect(takeWarnings()).toEqual([
      expect.stringMatching(/^\[state-viewer\] Can't preview "checkout#1": "nope" is not a leaf state/),
    ]);
    expect(registry.getSnapshot().overrides).toEqual({});
  });

  test('a later link for the machine replaces the earlier one, and may warn again', () => {
    const registry = setup();
    registry.link([{ machineId: 'checkout', leaves: [ERROR] }]);
    registry.register(fakeHandle({ instanceId: '1' }));
    expect(takeWarnings()).toEqual([expect.stringMatching(LIVE_WARNING)]);

    registry.link([{ machineId: 'checkout', leaves: [SUCCESS] }]);
    registry.register(fakeHandle({ instanceId: '2' }));
    expect(takeWarnings()).toEqual([expect.stringMatching(LIVE_WARNING)]);
    expect(registry.getOverride('checkout#1')?.requested).toEqual([ERROR]);
    expect(registry.getOverride('checkout#2')?.requested).toEqual([SUCCESS]);
  });

  test('ignores targets that aren’t a machine id with string leaves, with a warning each', async () => {
    const registry = setupWithFixture();
    registry.register(fakeHandle());

    registry.link([
      { machineId: '', leaves: [ERROR] },
      { machineId: 'checkout', leaves: [] },
      { machineId: 'checkout', leaves: [ERROR, 1] } as never,
      null as never,
    ]);
    registry.link('checkout:error' as never);
    await settle();

    expect(takeWarnings()).toEqual([
      ...Array(4).fill(expect.stringMatching(/^\[state-viewer\] Ignoring a deep link target: /)),
      expect.stringMatching(/^\[state-viewer\] Ignoring a deep link: expected an array/),
    ]);
    expect(registry.getSnapshot().overrides).toEqual({});
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
