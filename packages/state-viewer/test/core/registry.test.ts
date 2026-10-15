import { act, render } from '@testing-library/react';
import { Fragment, createElement, useEffect, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { STORAGE_PREFIX } from '../../src/core/recording';
import {
  REGISTRY_KEY,
  createNoopRegistry,
  createRegistry,
  toInstanceKey,
  type RegistryOptions,
} from '../../src/core/registry';
import type {
  EventLogEntry,
  FixtureSet,
  MachineHandle,
  Registry,
  RegistrySnapshot,
  StateNodeInfo,
  StateNodeType,
} from '../../src/core/types';
import { VERSION } from '../../src/core/version';

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

function logEntry(type: string, instanceKey = 'checkout#1'): EventLogEntry {
  return { instanceKey, event: { type }, leaves: [IDLE, STANDARD], blocked: true, at: 0 };
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

function takeErrors(): unknown[][] {
  const calls = [...error.mock.calls];
  error.mockClear();
  return calls;
}

/** Lets queued microtasks run, including flushes scheduled by other flushes. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function dataKeys(snapshot: RegistrySnapshot): string[] {
  return Object.keys(snapshot.data);
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

describe('toInstanceKey', () => {
  test('joins the machine id and instance id with #', () => {
    expect(toInstanceKey('checkout', ':r1:')).toBe('checkout#:r1:');
  });
});

describe('register', () => {
  test('lists machines in registration order and removes them on unregister', () => {
    const registry = setup();
    const first = fakeHandle();
    const cart = fakeHandle({ machineId: 'cart' });
    const second = fakeHandle({ instanceId: '2' });
    registry.register(first);
    const unregisterCart = registry.register(cart);
    registry.register(second);
    expect(registry.getSnapshot().machines).toEqual([first, cart, second]);

    unregisterCart();
    expect(registry.getSnapshot().machines).toEqual([first, second]);
  });

  test('warns and ignores a handle without a machineId or instanceId', async () => {
    const registry = setup();
    const listener = vi.fn();
    registry.subscribe(listener);
    const invalid = [
      fakeHandle({ machineId: '' }),
      fakeHandle({ instanceId: '' }),
      fakeHandle({ machineId: undefined as unknown as string }),
      fakeHandle({ instanceId: 7 as unknown as string }),
    ];
    for (const handle of invalid) {
      const unregister = registry.register(handle);
      expect(unregister).toBeTypeOf('function');
      unregister();
    }

    expect(takeWarnings()).toEqual(Array(4).fill(expect.stringMatching(/^\[state-viewer\] .*machineId/)));
    expect(registry.getSnapshot().machines).toEqual([]);
    await settle();
    expect(listener).not.toHaveBeenCalled();
  });

  test("keeps the new handle through StrictMode's register, unregister, register", () => {
    const registry = setup();
    const unregisterFirst = registry.register(fakeHandle());
    unregisterFirst();
    const second = fakeHandle();
    registry.register(second);

    expect(registry.getSnapshot().machines).toEqual([second]);
  });

  test('a different handle under an existing key replaces it in place, and the stale unregister leaves it', () => {
    const registry = setup();
    const first = fakeHandle();
    const cart = fakeHandle({ machineId: 'cart' });
    const unregisterFirst = registry.register(first);
    registry.register(cart);
    const second = fakeHandle();
    registry.register(second);
    expect(registry.getSnapshot().machines).toEqual([second, cart]);

    unregisterFirst();
    expect(registry.getSnapshot().machines).toEqual([second, cart]);
  });

  test('unregister is idempotent, even after the same handle registers again', () => {
    const registry = setup();
    const handle = fakeHandle();
    const unregister = registry.register(handle);
    unregister();
    unregister();
    expect(registry.getSnapshot().machines).toEqual([]);

    registry.register(handle);
    unregister();
    expect(registry.getSnapshot().machines).toEqual([handle]);
  });

  test('registering the same handle again changes nothing and returns a working unregister', async () => {
    const registry = setup();
    const handle = fakeHandle();
    registry.register(handle);
    await settle();
    const before = registry.getSnapshot();
    const listener = vi.fn();
    registry.subscribe(listener);

    const unregister = registry.register(handle);
    expect(registry.getSnapshot()).toBe(before);
    await settle();
    expect(listener).not.toHaveBeenCalled();

    unregister();
    expect(registry.getSnapshot().machines).toEqual([]);
  });

  test('unregister drops the override at the end of the tick and notifies its listeners', async () => {
    const registry = setup();
    const handle = fakeHandle();
    const unregister = registry.register(handle);
    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    const listener = vi.fn(() => registry.getOverride('checkout#1'));
    registry.onOverride('checkout#1', listener);
    const snapshots: RegistrySnapshot[] = [];
    registry.subscribe(() => snapshots.push(registry.getSnapshot()));

    unregister();
    expect(registry.getSnapshot().machines).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveLastReturnedWith(undefined);
    expect(registry.getOverride('checkout#1')).toBeUndefined();
    // One notification, which already has the override gone.
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].overrides).toEqual({});

    registry.register(handle);
    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveLastReturnedWith(registry.getOverride('checkout#1'));
  });

  test('unregister then register of the same handle in one tick keeps the override and the order', async () => {
    const registry = setup();
    const first = fakeHandle();
    const unregisterFirst = registry.register(first);
    registry.register(fakeHandle({ instanceId: '2' }));
    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    const override = registry.getOverride('checkout#1');
    await settle();
    const before = registry.getSnapshot();
    const listener = vi.fn();
    const overrideListener = vi.fn();
    registry.subscribe(listener);
    registry.onOverride('checkout#1', overrideListener);

    // What Fast Refresh does to the effect that registered the instance: cleanup, then setup again.
    unregisterFirst();
    const unregisterAgain = registry.register(first);
    await settle();
    expect(registry.getOverride('checkout#1')).toBe(override);
    expect(registry.getSnapshot()).toBe(before);
    expect(overrideListener).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();

    // The earlier unregister stays spent; the new one still works.
    unregisterFirst();
    await settle();
    expect(registry.getOverride('checkout#1')).toBe(override);
    unregisterAgain();
    await settle();
    expect(registry.getOverride('checkout#1')).toBeUndefined();
    expect(overrideListener).toHaveBeenCalledTimes(1);
  });

  test('an instance unregistered in this tick is no longer previewed or recorded', () => {
    vi.useFakeTimers();
    const registry = setup();
    const unregister = registry.register(fakeHandle());
    unregister();

    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    expect(takeWarnings()).toEqual([expect.stringMatching(/^\[state-viewer\] Can't preview "checkout#1": no machine/)]);
    registry.record('checkout#1', [ERROR, STANDARD], {});
    expect(registry.getSnapshot().data).toEqual({});
    vi.runAllTimers();
    expect(storage.length).toBe(0);
  });

  test('a new handle registering in the same tick keeps an override its tree still has, in place', async () => {
    const registry = setup();
    const unregisterFirst = registry.register(fakeHandle());
    const other = fakeHandle({ instanceId: '2' });
    registry.register(other);
    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    const override = registry.getOverride('checkout#1');
    const overrideListener = vi.fn();
    registry.onOverride('checkout#1', overrideListener);

    // A machine edit gives the hook a new actor, so a new handle registers under the same key.
    unregisterFirst();
    const swapped = fakeHandle();
    registry.register(swapped);
    await settle();
    expect(registry.getOverride('checkout#1')).toBe(override);
    expect(overrideListener).not.toHaveBeenCalled();
    expect(registry.getSnapshot().machines).toEqual([swapped, other]);
  });

  const WITHOUT_ERROR: StateNodeInfo[] = [
    node('checkout', 'parallel', [
      node('checkout.payment', 'compound', [node('checkout.payment.idle', 'atomic')]),
      node('checkout.shipping', 'compound', [node('checkout.shipping.standard', 'atomic')]),
    ]),
  ];

  test.each([
    ['replaces it while registered', false],
    ['registers in the same tick as the unregister', true],
  ])('a new handle whose tree lacks the overridden leaf releases the override when it %s', async (_, cleanup) => {
    const registry = setup();
    const unregister = registry.register(fakeHandle());
    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    const overrideListener = vi.fn(() => registry.getOverride('checkout#1'));
    registry.onOverride('checkout#1', overrideListener);

    if (cleanup) unregister();
    registry.register(fakeHandle({ describe: () => WITHOUT_ERROR }));
    expect(registry.getOverride('checkout#1')).toBeUndefined();
    expect(overrideListener).toHaveBeenCalledTimes(1);
    expect(overrideListener).toHaveLastReturnedWith(undefined);
    await settle();
    expect(registry.getSnapshot().overrides).toEqual({});
  });

  test('a new handle whose describe throws releases the override with a warning', () => {
    const registry = setup();
    registry.register(fakeHandle());
    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    const failure = new Error('no tree');

    registry.register(
      fakeHandle({
        describe: () => {
          throw failure;
        },
      }),
    );
    expect(registry.getOverride('checkout#1')).toBeUndefined();
    expect(warn.mock.calls).toEqual([[expect.stringMatching(/^\[state-viewer\] .*"checkout#1".*describe/), failure]]);
    takeWarnings();
  });

  test('a new handle that can’t have the previewed leaves active together releases the override', () => {
    const registry = setup();
    registry.register(fakeHandle());
    registry.preview('checkout#1', { leaves: [ERROR, EXPRESS], source: 'live' });

    // `checkout` edited from parallel into compound: both leaves still exist, but only one can be active.
    registry.register(fakeHandle({ normalizeTarget: (target) => target.slice(0, 1) }));
    expect(registry.getOverride('checkout#1')).toBeUndefined();
  });

  test('a new handle whose normalizeTarget adds leaves keeps the override, with the added leaves', () => {
    const registry = setup();
    registry.register(fakeHandle());
    registry.preview('checkout#1', { leaves: [ERROR, EXPRESS], source: 'live' });
    const override = registry.getOverride('checkout#1')!;
    const overrideListener = vi.fn();
    registry.onOverride('checkout#1', overrideListener);

    // A `gift` region added to `checkout`.
    registry.register(fakeHandle({ normalizeTarget: (target) => [...target, 'checkout.gift.none'] }));
    expect(registry.getOverride('checkout#1')).toEqual({ ...override, leaves: [ERROR, EXPRESS, 'checkout.gift.none'] });
    expect(overrideListener).toHaveBeenCalledTimes(1);
  });

  test('a preview of a chosen source keeps it after a new handle adds leaves, as fixtures register', () => {
    const registry = setup();
    registry.register(fakeHandle());
    registry.preview('checkout#1', { leaves: [ERROR, EXPRESS], source: 'live' });
    registry.register(fakeHandle({ normalizeTarget: (target) => [...target, 'checkout.gift.none'] }));

    registry.registerFixtures([fixtureSet('checkout', { [ERROR]: { from: 'fixture' } })]);
    expect(registry.getOverride('checkout#1')).toMatchObject({ source: 'live', context: { from: 'live' } });
  });

  test('a new handle whose normalizeTarget throws releases the override with a warning', () => {
    const registry = setup();
    registry.register(fakeHandle());
    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    const failure = new Error('no regions');

    registry.register(
      fakeHandle({
        normalizeTarget: () => {
          throw failure;
        },
      }),
    );
    expect(registry.getOverride('checkout#1')).toBeUndefined();
    expect(warn.mock.calls).toEqual([
      [expect.stringMatching(/^\[state-viewer\] .*"checkout#1".*normalizeTarget/), failure],
    ]);
    takeWarnings();
  });

  test('a stale unregister leaves the override of the newer registration alone', () => {
    const registry = setup();
    const unregisterFirst = registry.register(fakeHandle());
    registry.register(fakeHandle());
    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    const override = registry.getOverride('checkout#1');

    unregisterFirst();
    expect(registry.getOverride('checkout#1')).toBe(override);
  });
});

describe('getSnapshot', () => {
  test('starts empty and is the same object while nothing changes', async () => {
    const registry = setup();
    const snapshot = registry.getSnapshot();
    expect(snapshot).toEqual({ machines: [], overrides: {}, log: [], data: {} });
    expect(registry.getSnapshot()).toBe(snapshot);
    await settle();
    expect(registry.getSnapshot()).toBe(snapshot);
  });

  test('returns a new object after a change and reuses the parts that did not change', () => {
    const registry = setup();
    registry.register(fakeHandle());
    const before = registry.getSnapshot();

    registry.logEvent(logEntry('RETRY'));
    const after = registry.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.log).not.toBe(before.log);
    expect(after.machines).toBe(before.machines);
    expect(after.overrides).toBe(before.overrides);
    expect(after.data).toBe(before.data);
    expect(registry.getSnapshot()).toBe(after);
  });

  test('freezes the snapshot and its arrays and records', () => {
    const registry = setup();
    registry.register(fakeHandle());
    registry.logEvent(logEntry('RETRY'));
    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    const snapshot = registry.getSnapshot();

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.machines)).toBe(true);
    expect(Object.isFrozen(snapshot.overrides)).toBe(true);
    expect(Object.isFrozen(snapshot.log)).toBe(true);
    expect(Object.isFrozen(snapshot.data)).toBe(true);
    expect(Object.isFrozen(snapshot.data.checkout)).toBe(true);
    expect(() => snapshot.machines.push(fakeHandle())).toThrow(TypeError);
  });

  test('keys records by machine id safely, even for ids like __proto__', () => {
    const registry = setup();
    registry.register(fakeHandle({ machineId: '__proto__' }));
    registry.register(fakeHandle({ machineId: 'constructor' }));
    const snapshot = registry.getSnapshot();

    const data: Record<string, unknown> = snapshot.data;
    expect(dataKeys(snapshot)).toEqual(['__proto__', 'constructor']);
    expect(data.__proto__).toEqual({ recorded: new Set(), fixture: new Set() });
    expect(data.constructor).toEqual({ recorded: new Set(), fixture: new Set() });
    expect(data.toString).toBeUndefined();
  });
});

describe('batching', () => {
  test('several changes in one tick give one notification after a microtask', async () => {
    const registry = setup();
    const listener = vi.fn();
    registry.subscribe(listener);

    registry.register(fakeHandle());
    registry.logEvent(logEntry('A'));
    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    registry.registerFixtures([fixtureSet('checkout', { [ERROR]: {} })]);
    expect(listener).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('getSnapshot is current before listeners are notified', () => {
    const registry = setup();
    const listener = vi.fn();
    registry.subscribe(listener);
    const handle = fakeHandle();

    registry.register(handle);
    expect(registry.getSnapshot().machines).toEqual([handle]);
    expect(listener).not.toHaveBeenCalled();
  });

  test('a listener that makes a change gets another notification', async () => {
    const registry = setup();
    const seen: number[] = [];
    registry.subscribe(() => {
      const { log } = registry.getSnapshot();
      seen.push(log.length);
      if (log.length === 1) registry.logEvent(logEntry('FROM_LISTENER'));
    });

    registry.logEvent(logEntry('A'));
    await settle();
    expect(seen).toEqual([1, 2]);
  });

  test('a throwing listener does not stop the others', async () => {
    const registry = setup();
    const failure = new Error('boom');
    const before = vi.fn();
    const after = vi.fn();
    registry.subscribe(before);
    registry.subscribe(() => {
      throw failure;
    });
    registry.subscribe(after);

    registry.logEvent(logEntry('A'));
    await settle();
    expect(before).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    expect(takeErrors()).toEqual([[expect.stringMatching(/^\[state-viewer\] /), failure]]);
  });

  test('skips unsubscribed listeners, even ones removed during a flush, and waits to call ones added', async () => {
    const registry = setup();
    const unsubscribed = vi.fn();
    registry.subscribe(unsubscribed)();
    const removed = vi.fn();
    const added = vi.fn();
    let unsubscribeRemoved = () => {};
    registry.subscribe(() => {
      unsubscribeRemoved();
      registry.subscribe(added);
    });
    unsubscribeRemoved = registry.subscribe(removed);

    registry.logEvent(logEntry('A'));
    await settle();
    expect(unsubscribed).not.toHaveBeenCalled();
    expect(removed).not.toHaveBeenCalled();
    expect(added).not.toHaveBeenCalled();

    registry.logEvent(logEntry('B'));
    await settle();
    expect(added).toHaveBeenCalledTimes(1);
  });

  test('a repeated unsubscribe leaves a later subscription of the same listener alone', async () => {
    const registry = setup();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    unsubscribe();
    registry.subscribe(listener);
    unsubscribe();

    registry.logEvent(logEntry('A'));
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('stays quiet when a change leaves the snapshot as it was', async () => {
    const registry = setup();
    registry.register(fakeHandle());
    await settle();
    const before = registry.getSnapshot();
    const listener = vi.fn();
    registry.subscribe(listener);

    // Fixtures for a machine that isn't on the page don't change any marker.
    registry.registerFixtures([fixtureSet('cart', { empty: {} })]);
    await settle();
    expect(registry.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('React integration', () => {
  function Machines({ registry, renders }: { registry: Registry; renders: RegistrySnapshot[] }) {
    const snapshot = useSyncExternalStore(registry.subscribe, registry.getSnapshot);
    renders.push(snapshot);
    return createElement('p', null, `${snapshot.machines.length} machines, ${snapshot.log.length} events`);
  }

  test('re-renders with the new state after a change, and not when nothing changed', async () => {
    const registry = setup();
    const renders: RegistrySnapshot[] = [];
    const { container } = render(createElement(Machines, { registry, renders }));
    expect(container.textContent).toBe('0 machines, 0 events');

    const handle = fakeHandle();
    await act(async () => {
      registry.register(handle);
      registry.logEvent(logEntry('A'));
    });
    expect(container.textContent).toBe('1 machines, 1 events');
    expect(renders.at(-1)).toBe(registry.getSnapshot());

    const count = renders.length;
    await act(async () => {
      registry.register(handle);
      registry.release();
      registry.registerFixtures([fixtureSet('cart', { empty: {} })]);
    });
    expect(renders).toHaveLength(count);
    expect(container.textContent).toBe('1 machines, 1 events');
  });

  test('a preview and its row survive the registration effect running again, as on Fast Refresh', async () => {
    const registry = setup();
    function Row({ handle, revision }: { handle: MachineHandle; revision: number }) {
      // Fast Refresh runs every effect of an edited component again, cleanup first, whatever its dependencies.
      useEffect(() => registry.register(handle), [handle, revision]);
      return null;
    }
    const other = fakeHandle({ instanceId: '2' });
    const rows = (handle: MachineHandle, revision: number) =>
      createElement(
        Fragment,
        null,
        createElement(Row, { handle, revision }),
        createElement(Row, { handle: other, revision: 0 }),
      );
    const first = fakeHandle();
    const view = render(rows(first, 0));
    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    const override = registry.getOverride('checkout#1');

    view.rerender(rows(first, 1));
    await settle();
    expect(registry.getOverride('checkout#1')).toBe(override);
    expect(registry.getSnapshot().machines).toEqual([first, other]);

    // Editing the machine gives the hook a new actor, and so a new handle.
    const swapped = fakeHandle();
    view.rerender(rows(swapped, 1));
    await settle();
    expect(registry.getOverride('checkout#1')).toBe(override);
    expect(registry.getSnapshot().machines).toEqual([swapped, other]);

    view.unmount();
    await settle();
    expect(registry.getOverride('checkout#1')).toBeUndefined();
    expect(registry.getSnapshot().machines).toEqual([]);
  });
});

describe('preview', () => {
  test('warns for an unknown instance', async () => {
    const registry = setup();
    const listener = vi.fn();
    registry.subscribe(listener);

    registry.preview('nope#1', { leaves: [ERROR] });
    expect(takeWarnings()).toEqual([expect.stringMatching(/^\[state-viewer\] .*"nope#1"/)]);
    expect(registry.getOverride('nope#1')).toBeUndefined();
    await settle();
    expect(listener).not.toHaveBeenCalled();
  });

  test('warns when the adapter cannot preview', () => {
    const registry = setup();
    const handle = fakeHandle({ capabilities: { preview: false, live: false, children: false } });
    handle.normalizeTarget = vi.fn(handle.normalizeTarget);
    registry.register(handle);

    registry.preview('checkout#1', { leaves: [ERROR] });
    expect(takeWarnings()).toEqual([expect.stringMatching(/^\[state-viewer\] .*"checkout#1".*preview/)]);
    expect(registry.getOverride('checkout#1')).toBeUndefined();
    expect(handle.normalizeTarget).not.toHaveBeenCalled();
  });

  test('warns when no leaves are given', () => {
    const registry = setup();
    registry.register(fakeHandle());

    registry.preview('checkout#1', { leaves: [] });
    expect(takeWarnings()).toEqual([expect.stringMatching(/^\[state-viewer\] .*no leaves/)]);
    expect(registry.getOverride('checkout#1')).toBeUndefined();
  });

  test('drops unknown and non-leaf states with a warning that names them', () => {
    const registry = setup();
    registry.register(fakeHandle());

    registry.preview('checkout#1', { leaves: ['nope', ERROR, 'checkout'], source: 'live' });
    const [warning] = takeWarnings();
    expect(warning).toMatch(/^\[state-viewer\] Ignoring "nope", "checkout" in the preview of "checkout#1"/);
    expect(registry.getOverride('checkout#1')?.leaves).toEqual([ERROR, STANDARD]);
  });

  test('changes nothing when every leaf is invalid', async () => {
    const registry = setup();
    registry.register(fakeHandle());
    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    await settle();
    const override = registry.getOverride('checkout#1');
    const snapshot = registry.getSnapshot();
    const listener = vi.fn();
    const overrideListener = vi.fn();
    registry.subscribe(listener);
    registry.onOverride('checkout#1', overrideListener);

    registry.preview('checkout#1', { leaves: ['checkout.payment', 'nope'] });
    expect(takeWarnings()).toEqual([
      expect.stringMatching(/^\[state-viewer\] Can't preview "checkout#1": "checkout.payment", "nope" are not leaf/),
    ]);
    expect(registry.getOverride('checkout#1')).toBe(override);
    expect(overrideListener).not.toHaveBeenCalled();
    await settle();
    expect(registry.getSnapshot()).toBe(snapshot);
    expect(listener).not.toHaveBeenCalled();
  });

  test("passes the de-duplicated leaves to normalizeTarget and uses its result as the override's leaves", () => {
    const registry = setup();
    const handle = fakeHandle({ leaves: [IDLE, EXPRESS] });
    const normalized = [ERROR, EXPRESS];
    handle.normalizeTarget = vi.fn(() => normalized);
    registry.register(handle);

    registry.preview('checkout#1', { leaves: [ERROR, 'done', ERROR], source: 'live' });
    expect(handle.normalizeTarget).toHaveBeenCalledWith([ERROR, 'done']);
    const override = registry.getOverride('checkout#1');
    expect(override?.leaves).toEqual([ERROR, EXPRESS]);
    // normalizeTarget dropped "done" as conflicting, so it isn't among the requested leaves either.
    expect(override?.requested).toEqual([ERROR]);

    normalized.push('mutated');
    expect(override?.leaves).toEqual([ERROR, EXPRESS]);
    expect(Object.isFrozen(override?.leaves)).toBe(true);
    expect(Object.isFrozen(override?.requested)).toBe(true);
  });

  // Document order, as an adapter that converts through a state value returns it.
  function documentOrder(handle: FakeHandle): (target: string[]) => string[] {
    const order = [IDLE, ERROR, SUCCESS, STANDARD, EXPRESS];
    return (target) => fillRegions(TREE, target, handle.leaves).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }

  test('keeps the requested leaves in the order given when normalizeTarget returns them in document order', () => {
    const registry = setup();
    const handle = fakeHandle();
    handle.normalizeTarget = documentOrder(handle);
    registry.register(handle);

    registry.preview('checkout#1', { leaves: [EXPRESS, ERROR], source: 'live' });
    expect(registry.getOverride('checkout#1')).toMatchObject({ requested: [EXPRESS, ERROR], leaves: [EXPRESS, ERROR] });
  });

  test('switching the source keeps the requested leaves, and re-previewing override.leaves keeps the context', () => {
    const registry = setup();
    const handle = fakeHandle();
    handle.normalizeTarget = documentOrder(handle);
    registry.register(handle);
    const express = { from: 'fixture', leaf: 'express' };
    const idle = { from: 'fixture', leaf: 'idle' };
    registry.registerFixtures([fixtureSet('checkout', { [IDLE]: idle, [EXPRESS]: express })]);

    registry.preview('checkout#1', { leaves: [EXPRESS] });
    const first = registry.getOverride('checkout#1');
    expect(first).toMatchObject({ requested: [EXPRESS], leaves: [EXPRESS, IDLE], source: 'fixture', context: express });

    // What switching the data source does.
    registry.preview('checkout#1', { leaves: [...(first?.requested ?? [])], source: 'live' });
    expect(registry.getOverride('checkout#1')).toMatchObject({
      requested: [EXPRESS],
      leaves: [EXPRESS, IDLE],
      source: 'live',
    });

    // The requested leaf comes first in the configuration, so its fixture still wins.
    registry.preview('checkout#1', { leaves: [...(first?.leaves ?? [])] });
    expect(registry.getOverride('checkout#1')).toMatchObject({ leaves: [EXPRESS, IDLE], context: express });
  });

  test('a requested leaf that normalizeTarget dropped as conflicting does not pick the context', () => {
    const registry = setup();
    // Two leaves of one region; the adapter keeps the second.
    registry.register(fakeHandle({ normalizeTarget: () => [ERROR, STANDARD] }));
    registry.registerFixtures([fixtureSet('checkout', { [SUCCESS]: { from: 'fixture', leaf: 'success' } })]);

    registry.preview('checkout#1', { leaves: [SUCCESS, ERROR] });
    expect(registry.getOverride('checkout#1')).toMatchObject({
      requested: [ERROR],
      leaves: [ERROR, STANDARD],
      source: 'live',
    });
    expect(takeWarnings()).toEqual([
      `[state-viewer] No recorded or fixture context for "${ERROR}" on "checkout#1", ` +
        'so the preview uses the live context.',
    ]);
  });

  test.each([
    ['another configuration', [IDLE, STANDARD]],
    ['nothing', []],
  ])('warns and leaves no override when normalizeTarget returns %s', (_, normalized) => {
    const registry = setup();
    registry.register(fakeHandle({ normalizeTarget: () => normalized }));

    registry.preview('checkout#1', { leaves: [ERROR] });
    expect(takeWarnings()).toEqual([
      `[state-viewer] Can't preview "checkout#1": normalizeTarget() kept none of the requested leaves.`,
    ]);
    expect(registry.getOverride('checkout#1')).toBeUndefined();
  });

  test('a throwing normalizeTarget warns and leaves no override', () => {
    const registry = setup();
    const failure = new Error('bad target');
    registry.register(
      fakeHandle({
        normalizeTarget: () => {
          throw failure;
        },
      }),
    );

    registry.preview('checkout#1', { leaves: [ERROR] });
    expect(warn.mock.calls).toEqual([[expect.stringMatching(/^\[state-viewer\] .*normalizeTarget/), failure]]);
    takeWarnings();
    expect(registry.getOverride('checkout#1')).toBeUndefined();
  });

  test('a throwing describe warns and leaves no override', () => {
    const registry = setup();
    registry.register(
      fakeHandle({
        describe: () => {
          throw new Error('no tree');
        },
      }),
    );

    registry.preview('checkout#1', { leaves: [ERROR] });
    expect(takeWarnings()).toEqual([expect.stringMatching(/^\[state-viewer\] .*describe/)]);
    expect(registry.getOverride('checkout#1')).toBeUndefined();
  });

  test('reads the state tree once per handle', () => {
    const registry = setup();
    const describe = vi.fn(() => TREE);
    registry.register(fakeHandle({ describe }));

    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    registry.preview('checkout#1', { leaves: ['done'], source: 'live' });
    expect(describe).toHaveBeenCalledTimes(1);
  });

  test('accepts final states nested anywhere in the tree as leaves', () => {
    const registry = setup();
    const tree = [node('a', 'compound', [node('a.b', 'compound', [node('a.b.end', 'final')])])];
    registry.register(fakeHandle({ describe: () => tree, normalizeTarget: (leaves) => leaves }));

    registry.preview('checkout#1', { leaves: ['a.b.end'], source: 'live' });
    expect(registry.getOverride('checkout#1')?.leaves).toEqual(['a.b.end']);
  });

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

describe('context resolution', () => {
  const recorded = { from: 'recorded' };
  const errorFixture = { from: 'fixture', leaf: 'error' };
  const successFixture = { from: 'fixture', leaf: 'success' };

  function setupWithData(): { registry: Registry; handle: FakeHandle } {
    const registry = setup();
    const handle = fakeHandle();
    handle.getContext = vi.fn(handle.getContext);
    registry.register(handle);
    registry.record('checkout#1', [ERROR, STANDARD], recorded);
    registry.registerFixtures([fixtureSet('checkout', { [ERROR]: errorFixture, [SUCCESS]: successFixture })]);
    return { registry, handle };
  }

  test('prefers recorded, then fixture, then live', () => {
    const { registry, handle } = setupWithData();

    registry.preview('checkout#1', { leaves: [ERROR] });
    expect(registry.getOverride('checkout#1')).toMatchObject({ source: 'recorded', context: recorded });
    registry.preview('checkout#1', { leaves: [SUCCESS] });
    expect(registry.getOverride('checkout#1')).toMatchObject({ source: 'fixture', context: successFixture });
    expect(handle.getContext).not.toHaveBeenCalled();

    registry.preview('checkout#1', { leaves: [IDLE] });
    expect(registry.getOverride('checkout#1')).toMatchObject({ source: 'live', context: handle.context });
    expect(takeWarnings()).toEqual([
      `[state-viewer] No recorded or fixture context for "${IDLE}" on "checkout#1", ` +
        'so the preview uses the live context.',
    ]);
  });

  test('honors an explicit source', () => {
    const { registry, handle } = setupWithData();

    registry.preview('checkout#1', { leaves: [ERROR], source: 'fixture' });
    expect(registry.getOverride('checkout#1')).toMatchObject({ source: 'fixture', context: errorFixture });
    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    expect(registry.getOverride('checkout#1')).toMatchObject({ source: 'live', context: handle.context });
    registry.preview('checkout#1', { leaves: [ERROR], source: 'recorded' });
    expect(registry.getOverride('checkout#1')).toMatchObject({ source: 'recorded', context: recorded });
  });

  test('falls back in the default order with a warning when the explicit source is unavailable', () => {
    const { registry } = setupWithData();

    registry.preview('checkout#1', { leaves: [SUCCESS], source: 'recorded' });
    expect(registry.getOverride('checkout#1')).toMatchObject({ source: 'fixture', context: successFixture });
    expect(takeWarnings()).toEqual([
      `[state-viewer] No recorded context for "${SUCCESS}" on "checkout#1", so the preview uses the fixture context.`,
    ]);

    registry.preview('checkout#1', { leaves: [EXPRESS], source: 'fixture' });
    expect(registry.getOverride('checkout#1')?.source).toBe('live');
    expect(takeWarnings()).toEqual([expect.stringMatching(/^\[state-viewer\] No recorded or fixture context/)]);
  });

  test('uses live context with exactly one warning when there is neither a recording nor a fixture', () => {
    const { registry } = setupWithData();

    registry.preview('checkout#1', { leaves: ['browsing'] });
    expect(registry.getOverride('checkout#1')?.source).toBe('live');
    expect(takeWarnings()).toHaveLength(1);
    registry.preview('checkout#1', { leaves: ['browsing'], source: 'recorded' });
    expect(takeWarnings()).toHaveLength(1);
  });

  test('an explicit live source never warns', () => {
    const { registry } = setupWithData();

    registry.preview('checkout#1', { leaves: ['browsing'], source: 'live' });
    expect(registry.getOverride('checkout#1')?.source).toBe('live');
    expect(takeWarnings()).toEqual([]);
  });

  test('an unknown explicit source falls back with a warning', () => {
    const { registry } = setupWithData();

    registry.preview('checkout#1', { leaves: [ERROR], source: 'cached' as 'live' });
    expect(registry.getOverride('checkout#1')?.source).toBe('recorded');
    expect(takeWarnings()).toEqual([expect.stringMatching(/^\[state-viewer\] No cached context/)]);
  });

  test('captures the live context at preview time', () => {
    const registry = setup();
    const handle = fakeHandle();
    registry.register(handle);
    const atPreview = handle.context;

    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    handle.context = { from: 'later' };
    handle.leaves = ['done'];
    expect(registry.getOverride('checkout#1')?.context).toBe(atPreview);
    expect(registry.getOverride('checkout#1')?.leaves).toEqual([ERROR, STANDARD]);
  });

  test('a throwing getContext warns and leaves no override', () => {
    const registry = setup();
    registry.register(
      fakeHandle({
        getContext: () => {
          throw new Error('stopped');
        },
      }),
    );

    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    expect(takeWarnings()).toEqual([expect.stringMatching(/^\[state-viewer\] .*getContext/)]);
    expect(registry.getOverride('checkout#1')).toBeUndefined();
  });

  test("matches a fixture by source when the handle's machine id differs from the set's (debug.id)", () => {
    const registry = setup();
    const machine = { id: 'checkout' };
    const fixture = { from: 'fixture' };
    registry.register(fakeHandle({ machineId: 'checkout-debug', source: machine }));
    registry.registerFixtures([fixtureSet('checkout', { [ERROR]: fixture }, machine)]);

    expect([...registry.getSnapshot().data['checkout-debug'].fixture]).toEqual([ERROR]);
    registry.preview('checkout-debug#1', { leaves: [ERROR] });
    expect(registry.getOverride('checkout-debug#1')).toMatchObject({ source: 'fixture', context: fixture });
  });

  test('uses a fixture for a filled-in leaf when the requested leaves have none', () => {
    const registry = setup();
    const fixture = { from: 'fixture', leaf: 'standard' };
    registry.register(fakeHandle());
    registry.registerFixtures([fixtureSet('checkout', { [STANDARD]: fixture })]);

    registry.preview('checkout#1', { leaves: [ERROR] });
    expect(registry.getOverride('checkout#1')).toMatchObject({ source: 'fixture', context: fixture });
  });
});

describe('fixtures registering after a preview', () => {
  const fixture = { from: 'fixture' };
  const LIVE_WARNING = /^\[state-viewer\] No recorded or fixture context/;

  test('move a preview made before them from live to the fixture, keeping its configuration', async () => {
    const registry = setup();
    const handle = fakeHandle();
    handle.normalizeTarget = vi.fn(handle.normalizeTarget);
    registry.register(handle);
    // What a deep link does on page load, before the lazy fixtures loader resolves.
    registry.preview('checkout#1', { leaves: [ERROR] });
    const before = registry.getOverride('checkout#1');
    expect(before?.source).toBe('live');
    expect(takeWarnings()).toEqual([expect.stringMatching(LIVE_WARNING)]);
    await settle();
    const listener = vi.fn();
    const overrideListener = vi.fn(() => registry.getOverride('checkout#1'));
    registry.subscribe(listener);
    registry.onOverride('checkout#1', overrideListener);

    // The actor moved on, so normalizing the target again would fill in another leaf.
    handle.leaves = [IDLE, EXPRESS];
    time = 2000;
    registry.registerFixtures([fixtureSet('checkout', { [ERROR]: fixture })]);
    const after = registry.getOverride('checkout#1');
    expect(after).toEqual({
      instanceKey: 'checkout#1',
      requested: [ERROR],
      leaves: [ERROR, STANDARD],
      context: fixture,
      source: 'fixture',
      createdAt: 2000,
    });
    expect(Object.isFrozen(after)).toBe(true);
    expect(after?.requested).toBe(before?.requested);
    expect(after?.leaves).toBe(before?.leaves);
    expect(handle.normalizeTarget).toHaveBeenCalledTimes(1);
    expect(overrideListener).toHaveBeenCalledTimes(1);
    expect(overrideListener).toHaveLastReturnedWith(after);
    expect(registry.getSnapshot().overrides['checkout#1']).toBe(after);
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('leave a preview on a recording alone, since recorded context wins', () => {
    const registry = setup();
    registry.register(fakeHandle());
    registry.record('checkout#1', [ERROR, STANDARD], { from: 'recorded' });
    registry.preview('checkout#1', { leaves: [ERROR] });
    const override = registry.getOverride('checkout#1');
    expect(override?.source).toBe('recorded');
    const overrideListener = vi.fn();
    registry.onOverride('checkout#1', overrideListener);

    registry.registerFixtures([fixtureSet('checkout', { [ERROR]: fixture })]);
    expect(registry.getOverride('checkout#1')).toBe(override);
    expect(overrideListener).not.toHaveBeenCalled();
  });

  test.each(['live', 'fixture'] as const)('leave a preview with an explicit %s source alone', (source) => {
    const registry = setup();
    registry.register(fakeHandle());
    registry.preview('checkout#1', { leaves: [ERROR], source });
    // Without fixtures yet, an explicit fixture source falls back to live with a warning.
    expect(takeWarnings()).toHaveLength(source === 'live' ? 0 : 1);
    const override = registry.getOverride('checkout#1');
    expect(override?.source).toBe('live');
    const overrideListener = vi.fn();
    registry.onOverride('checkout#1', overrideListener);

    registry.registerFixtures([fixtureSet('checkout', { [ERROR]: fixture })]);
    expect(registry.getOverride('checkout#1')).toBe(override);
    expect(overrideListener).not.toHaveBeenCalled();
  });

  test('update an open fixture preview when the fixtures file registers a changed fixture again, as on HMR', () => {
    const registry = setup();
    const machine = {};
    registry.register(fakeHandle({ source: machine }));
    registry.registerFixtures([fixtureSet('checkout', { [ERROR]: { version: 1 } }, machine)]);
    registry.preview('checkout#1', { leaves: [ERROR] });
    expect(registry.getOverride('checkout#1')).toMatchObject({ source: 'fixture', context: { version: 1 } });
    const overrideListener = vi.fn();
    registry.onOverride('checkout#1', overrideListener);

    const changed = { version: 2 };
    registry.registerFixtures([fixtureSet('checkout', { [ERROR]: changed }, machine)]);
    expect(registry.getOverride('checkout#1')).toMatchObject({ source: 'fixture', context: changed });
    expect(overrideListener).toHaveBeenCalledTimes(1);
  });

  test('for another machine change no override, not even a live one whose actor moved on', () => {
    const registry = setup();
    const first = fakeHandle({ leaves: [IDLE, EXPRESS] });
    registry.register(first);
    registry.register(fakeHandle({ instanceId: '2' }));
    registry.register(fakeHandle({ instanceId: '3' }));
    registry.record('checkout#3', [ERROR, EXPRESS], { from: 'recorded' });
    registry.registerFixtures([fixtureSet('checkout', { [SUCCESS]: fixture })]);
    // The recording contains the leaf normalizeTarget filled in for #1, but only requested leaves find recordings.
    registry.preview('checkout#1', { leaves: [IDLE] });
    registry.preview('checkout#2', { leaves: [SUCCESS] });
    registry.preview('checkout#3', { leaves: [ERROR] });
    expect(takeWarnings()).toEqual([expect.stringMatching(LIVE_WARNING)]);
    const before = registry.getSnapshot();
    expect(Object.values(before.overrides).map(({ source }) => source)).toEqual(['live', 'fixture', 'recorded']);
    const overrideListener = vi.fn();
    for (const key of ['checkout#1', 'checkout#2', 'checkout#3']) registry.onOverride(key, overrideListener);

    // A live preview keeps the context it captured.
    first.context = { from: 'later' };
    registry.registerFixtures([fixtureSet('cart', { empty: {} })]);
    expect(overrideListener).not.toHaveBeenCalled();
    expect(registry.getSnapshot().overrides).toBe(before.overrides);
  });

  test('skip an instance pending removal', async () => {
    const registry = setup();
    const unregister = registry.register(fakeHandle());
    registry.preview('checkout#1', { leaves: [ERROR] });
    expect(takeWarnings()).toEqual([expect.stringMatching(LIVE_WARNING)]);
    const override = registry.getOverride('checkout#1');
    const overrideListener = vi.fn(() => registry.getOverride('checkout#1'));
    registry.onOverride('checkout#1', overrideListener);

    unregister();
    registry.registerFixtures([fixtureSet('checkout', { [ERROR]: fixture })]);
    expect(registry.getOverride('checkout#1')).toBe(override);
    expect(overrideListener).not.toHaveBeenCalled();
    await settle();
    expect(overrideListener).toHaveBeenCalledTimes(1);
    expect(overrideListener).toHaveLastReturnedWith(undefined);
  });

  test('skip an override that a listener notified earlier released', () => {
    const registry = setup();
    registry.register(fakeHandle());
    registry.register(fakeHandle({ instanceId: '2' }));
    registry.preview('checkout#1', { leaves: [ERROR] });
    registry.preview('checkout#2', { leaves: [ERROR] });
    expect(takeWarnings()).toHaveLength(2);
    registry.onOverride('checkout#1', () => registry.release('checkout#2'));
    const second = vi.fn();
    registry.onOverride('checkout#2', second);

    registry.registerFixtures([fixtureSet('checkout', { [ERROR]: fixture })]);
    expect(registry.getOverride('checkout#1')?.source).toBe('fixture');
    expect(registry.getOverride('checkout#2')).toBeUndefined();
    expect(second).toHaveBeenCalledTimes(1);
  });

  test('fall back to live without a warning when the fixture a preview used no longer matches', () => {
    const registry = setup();
    const machine = {};
    const handle = fakeHandle({ source: machine });
    registry.register(handle);
    registry.registerFixtures([fixtureSet('checkout', { [ERROR]: fixture })]);
    registry.preview('checkout#1', { leaves: [ERROR] });
    expect(registry.getOverride('checkout#1')?.source).toBe('fixture');

    // Sets carrying the machine object win over sets matched by id, and these have no fixture for the preview.
    registry.registerFixtures([fixtureSet('checkout', { [SUCCESS]: {} }, machine)]);
    expect(registry.getOverride('checkout#1')).toMatchObject({ source: 'live', context: handle.context });
  });

  test('leave a preview alone, without a warning, when getContext throws', () => {
    const registry = setup();
    const machine = {};
    const handle = fakeHandle({ source: machine });
    registry.register(handle);
    registry.registerFixtures([fixtureSet('checkout', { [ERROR]: fixture })]);
    registry.preview('checkout#1', { leaves: [ERROR] });
    const override = registry.getOverride('checkout#1');
    handle.getContext = () => {
      throw new Error('stopped');
    };

    registry.registerFixtures([fixtureSet('checkout', { [SUCCESS]: {} }, machine)]);
    expect(registry.getOverride('checkout#1')).toBe(override);
  });

  test('a recording arriving leaves an open preview alone', async () => {
    const registry = setup();
    registry.register(fakeHandle());
    registry.preview('checkout#1', { leaves: [ERROR] });
    expect(takeWarnings()).toEqual([expect.stringMatching(LIVE_WARNING)]);
    const override = registry.getOverride('checkout#1');
    const overrideListener = vi.fn();
    registry.onOverride('checkout#1', overrideListener);

    registry.record('checkout#1', [ERROR, STANDARD], { from: 'recorded' });
    await settle();
    expect(registry.getOverride('checkout#1')).toBe(override);
    expect(overrideListener).not.toHaveBeenCalled();
  });

  // Recordings that arrived after a preview would move it with live traffic once any fixtures register.
  test('leave a preview on a recording alone when its configuration was recorded again since', () => {
    const registry = setup();
    registry.register(fakeHandle());
    registry.record('checkout#1', [ERROR, STANDARD], { attempt: 1 });
    registry.preview('checkout#1', { leaves: [ERROR] });
    const override = registry.getOverride('checkout#1');
    expect(override).toMatchObject({ source: 'recorded', context: { attempt: 1 } });
    const overrideListener = vi.fn();
    registry.onOverride('checkout#1', overrideListener);

    registry.record('checkout#1', [ERROR, STANDARD], { attempt: 2 });
    registry.registerFixtures([fixtureSet('cart', { empty: {} })]);
    registry.registerFixtures([fixtureSet('checkout', { [ERROR]: fixture })]);
    expect(registry.getOverride('checkout#1')).toBe(override);
    expect(overrideListener).not.toHaveBeenCalled();
  });

  test('move a live preview to a fixture, not to a recording that arrived since', () => {
    const registry = setup();
    registry.register(fakeHandle());
    registry.preview('checkout#1', { leaves: [ERROR] });
    expect(takeWarnings()).toEqual([expect.stringMatching(LIVE_WARNING)]);
    const override = registry.getOverride('checkout#1');
    const overrideListener = vi.fn();
    registry.onOverride('checkout#1', overrideListener);

    registry.record('checkout#1', [ERROR, EXPRESS], { from: 'recorded' });
    registry.registerFixtures([fixtureSet('cart', { empty: {} })]);
    expect(registry.getOverride('checkout#1')).toBe(override);
    expect(overrideListener).not.toHaveBeenCalled();

    registry.registerFixtures([fixtureSet('checkout', { [ERROR]: fixture })]);
    expect(registry.getOverride('checkout#1')).toMatchObject({
      leaves: [ERROR, STANDARD],
      source: 'fixture',
      context: fixture,
    });
    expect(overrideListener).toHaveBeenCalledTimes(1);
  });

  test('update a fixture preview to a changed fixture, not to a recording that arrived since', () => {
    const registry = setup();
    const machine = {};
    registry.register(fakeHandle({ source: machine }));
    registry.registerFixtures([fixtureSet('checkout', { [ERROR]: { version: 1 } }, machine)]);
    registry.preview('checkout#1', { leaves: [ERROR] });
    expect(registry.getOverride('checkout#1')?.source).toBe('fixture');

    registry.record('checkout#1', [ERROR, STANDARD], { from: 'recorded' });
    const changed = { version: 2 };
    registry.registerFixtures([fixtureSet('checkout', { [ERROR]: changed }, machine)]);
    expect(registry.getOverride('checkout#1')).toMatchObject({ source: 'fixture', context: changed });
  });
});

describe('fixtures after HMR', () => {
  test.each([
    ['registered before the handle', true],
    ['registered after the handle', false],
  ])('a machine under debug.id keeps fixtures %s, even if nothing read the snapshot', (_, fixturesFirst) => {
    const registry = setup();
    const machine = { id: 'checkout' };
    const fixture = { from: 'fixture' };
    const registerFixtures = () => registry.registerFixtures([fixtureSet('checkout', { [ERROR]: fixture }, machine)]);
    if (fixturesFirst) registerFixtures();
    const unregister = registry.register(fakeHandle({ machineId: 'checkout-v2', source: machine }));
    if (!fixturesFirst) registerFixtures();

    // HMR recreates the machine object, so the hook registers a new handle under the same key.
    unregister();
    registry.register(fakeHandle({ machineId: 'checkout-v2', source: { id: 'checkout' } }));
    expect([...registry.getSnapshot().data['checkout-v2'].fixture]).toEqual([ERROR]);
    registry.preview('checkout-v2#1', { leaves: [ERROR] });
    expect(registry.getOverride('checkout-v2#1')).toMatchObject({ source: 'fixture', context: fixture });
  });

  test("machines left on XState's default id keep only their own fixtures", () => {
    const registry = setup();
    const first = {};
    const second = {};
    registry.registerFixtures([
      fixtureSet('(machine)', { [ERROR]: {} }, first),
      fixtureSet('(machine)', { [SUCCESS]: {} }, second),
    ]);
    // Each gets its own generated id on its handle.
    const unregisterFirst = registry.register(fakeHandle({ machineId: 'machine-1', source: first }));
    const unregisterSecond = registry.register(fakeHandle({ machineId: 'machine-2', source: second }));

    unregisterFirst();
    unregisterSecond();
    registry.register(fakeHandle({ machineId: 'machine-1', source: {} }));
    registry.register(fakeHandle({ machineId: 'machine-2', source: {} }));
    const { data } = registry.getSnapshot();
    expect([...data['machine-1'].fixture]).toEqual([ERROR]);
    expect([...data['machine-2'].fixture]).toEqual([SUCCESS]);
  });

  test('a machine registered under two ids keeps its fixtures under both', () => {
    const registry = setup();
    const machine = { id: 'checkout' };
    registry.registerFixtures([fixtureSet('checkout', { [ERROR]: {} }, machine)]);
    // debug.id is per hook call, so one page can use the same machine under several ids.
    const unregisterFull = registry.register(fakeHandle({ source: machine }));
    const unregisterMini = registry.register(fakeHandle({ machineId: 'checkout-mini', source: machine }));

    unregisterFull();
    unregisterMini();
    registry.register(fakeHandle({ source: { id: 'checkout' } }));
    registry.register(fakeHandle({ machineId: 'checkout-mini', source: { id: 'checkout' } }));
    const { data } = registry.getSnapshot();
    expect([...data.checkout.fixture]).toEqual([ERROR]);
    expect([...data['checkout-mini'].fixture]).toEqual([ERROR]);
  });
});

describe('overrides', () => {
  function setupTwo(): Registry {
    const registry = setup();
    registry.register(fakeHandle());
    registry.register(fakeHandle({ instanceId: '2' }));
    return registry;
  }

  test('override listeners fire synchronously and only for their instance', () => {
    const registry = setupTwo();
    const first = vi.fn();
    const second = vi.fn();
    registry.onOverride('checkout#1', first);
    registry.onOverride('checkout#2', second);

    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  test('a listener sees the new override through getOverride, and the snapshot is already current', () => {
    const registry = setupTwo();
    const seen: unknown[] = [];
    registry.onOverride('checkout#1', () => {
      seen.push(registry.getOverride('checkout#1'), registry.getSnapshot().overrides['checkout#1']);
    });

    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    const override = registry.getOverride('checkout#1');
    expect(override).toEqual({
      instanceKey: 'checkout#1',
      requested: [ERROR],
      leaves: [ERROR, STANDARD],
      context: { from: 'live' },
      source: 'live',
      createdAt: 1000,
    });
    expect(seen).toEqual([override, override]);
    expect(seen[0]).toBe(override);
  });

  test('a throwing override listener does not stop the others', () => {
    const registry = setupTwo();
    const failure = new Error('boom');
    const other = vi.fn();
    registry.onOverride('checkout#1', () => {
      throw failure;
    });
    registry.onOverride('checkout#1', other);

    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    expect(other).toHaveBeenCalledTimes(1);
    expect(registry.getOverride('checkout#1')).toBeDefined();
    expect(takeErrors()).toEqual([[expect.stringMatching(/^\[state-viewer\] .*"checkout#1"/), failure]]);
  });

  test('release with a key releases only that instance', async () => {
    const registry = setupTwo();
    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    registry.preview('checkout#2', { leaves: [ERROR], source: 'live' });
    await settle();
    const listener = vi.fn();
    registry.subscribe(listener);
    const first = vi.fn();
    const second = vi.fn();
    registry.onOverride('checkout#1', first);
    registry.onOverride('checkout#2', second);

    registry.release('checkout#1');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(registry.getOverride('checkout#1')).toBeUndefined();
    expect(Object.keys(registry.getSnapshot().overrides)).toEqual(['checkout#2']);
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('release without a key releases every instance and notifies each one', async () => {
    const registry = setupTwo();
    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    registry.preview('checkout#2', { leaves: [ERROR], source: 'live' });
    await settle();
    const listener = vi.fn();
    registry.subscribe(listener);
    const first = vi.fn();
    const second = vi.fn();
    registry.onOverride('checkout#1', first);
    registry.onOverride('checkout#2', second);

    registry.release();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(registry.getSnapshot().overrides).toEqual({});
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('releasing nothing does not notify', async () => {
    const registry = setupTwo();
    registry.preview('checkout#2', { leaves: [ERROR], source: 'live' });
    await settle();
    const snapshot = registry.getSnapshot();
    const listener = vi.fn();
    const overrideListener = vi.fn();
    registry.subscribe(listener);
    registry.onOverride('checkout#1', overrideListener);

    registry.release('checkout#1');
    registry.release('nope#1');
    expect(overrideListener).not.toHaveBeenCalled();
    registry.release('checkout#2');
    registry.release();
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);

    registry.release();
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(registry.getSnapshot()).not.toBe(snapshot);
  });

  test('every preview creates a new frozen override', () => {
    const registry = setupTwo();
    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    const first = registry.getOverride('checkout#1');
    time = 2000;
    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    const second = registry.getOverride('checkout#1');

    expect(second).not.toBe(first);
    expect(second).toEqual({ ...first, createdAt: 2000 });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(second)).toBe(true);
    expect(Object.isFrozen(second?.requested)).toBe(true);
    expect(Object.isFrozen(second?.leaves)).toBe(true);
    expect(registry.getSnapshot().overrides['checkout#1']).toBe(second);
  });

  test('a listener can release re-entrantly', () => {
    const registry = setupTwo();
    const seen: unknown[] = [];
    registry.onOverride('checkout#1', () => {
      if (registry.getOverride('checkout#1')) registry.release('checkout#1');
    });
    registry.onOverride('checkout#1', () => seen.push(registry.getOverride('checkout#1')));

    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    expect(registry.getOverride('checkout#1')).toBeUndefined();
    expect(seen).toEqual([undefined, undefined]);
    expect(registry.getSnapshot().overrides).toEqual({});
  });

  test('a listener can preview re-entrantly', () => {
    const registry = setupTwo();
    registry.onOverride('checkout#1', () => {
      if (registry.getOverride('checkout#1')?.leaves[0] === ERROR) {
        registry.preview('checkout#1', { leaves: [SUCCESS], source: 'live' });
      }
    });

    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    expect(registry.getOverride('checkout#1')?.leaves).toEqual([SUCCESS, STANDARD]);
    expect(registry.getSnapshot().overrides['checkout#1']).toBe(registry.getOverride('checkout#1'));
  });

  test('onOverride returns an idempotent unsubscribe', () => {
    const registry = setupTwo();
    const listener = vi.fn();
    const kept = vi.fn();
    const unsubscribe = registry.onOverride('checkout#1', listener);
    registry.onOverride('checkout#1', kept);
    unsubscribe();
    unsubscribe();

    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    expect(listener).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
  });

  test('a notification skips listeners removed by an earlier listener and waits to call ones it added', () => {
    const registry = setupTwo();
    const removed = vi.fn();
    const added = vi.fn();
    let unsubscribeRemoved = () => {};
    registry.onOverride('checkout#1', () => {
      unsubscribeRemoved();
      registry.onOverride('checkout#1', added);
    });
    unsubscribeRemoved = registry.onOverride('checkout#1', removed);

    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    expect(removed).not.toHaveBeenCalled();
    expect(added).not.toHaveBeenCalled();
    registry.release('checkout#1');
    expect(added).toHaveBeenCalledTimes(1);
  });

  test('a repeated unsubscribe leaves a later subscription of the same listener alone', () => {
    const registry = setupTwo();
    const listener = vi.fn();
    const unsubscribe = registry.onOverride('checkout#1', listener);
    unsubscribe();
    registry.onOverride('checkout#1', listener);
    unsubscribe();

    registry.preview('checkout#1', { leaves: [ERROR], source: 'live' });
    expect(listener).toHaveBeenCalledTimes(1);
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

describe('fixtures and event log', () => {
  test('registerFixtures updates data.fixture and notifies', async () => {
    const registry = setup();
    registry.register(fakeHandle());
    await settle();
    const listener = vi.fn();
    registry.subscribe(listener);

    registry.registerFixtures([fixtureSet('checkout', { [ERROR]: {}, [SUCCESS]: {} })]);
    expect([...registry.getSnapshot().data.checkout.fixture].sort()).toEqual([ERROR, SUCCESS]);
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('data', () => {
  test('has one entry per machine id, shared by its instances and removed with the last one', () => {
    const registry = setup();
    const unregisterFirst = registry.register(fakeHandle());
    registry.register(fakeHandle({ machineId: 'cart' }));
    const unregisterSecond = registry.register(fakeHandle({ instanceId: '2' }));
    const before = registry.getSnapshot();
    expect(dataKeys(before)).toEqual(['checkout', 'cart']);

    unregisterFirst();
    const after = registry.getSnapshot();
    expect(after.data).toBe(before.data);
    expect(after.data.checkout).toBe(before.data.checkout);

    unregisterSecond();
    expect(dataKeys(registry.getSnapshot())).toEqual(['cart']);
  });

  test('reuses the DataAvailability of machines whose markers did not change', () => {
    const registry = setup();
    registry.register(fakeHandle());
    registry.register(fakeHandle({ machineId: 'cart' }));
    const before = registry.getSnapshot().data;

    registry.record('checkout#1', [ERROR, STANDARD], {});
    const after = registry.getSnapshot().data;
    expect(after).not.toBe(before);
    expect(after.checkout).not.toBe(before.checkout);
    expect(after.cart).toBe(before.cart);
  });

  test('uses the fixtures of the first registered instance of a machine', () => {
    const registry = setup();
    const machine = {};
    registry.registerFixtures([
      fixtureSet('checkout', { [ERROR]: {} }, machine),
      fixtureSet('checkout', { [SUCCESS]: {} }, {}),
    ]);
    registry.register(fakeHandle({ source: machine }));
    registry.register(fakeHandle({ instanceId: '2' }));

    expect([...registry.getSnapshot().data.checkout.fixture]).toEqual([ERROR]);
  });

  test('fixture follows the first registered instance, even where another instance has other fixtures', () => {
    const registry = setup();
    const first = {};
    const second = {};
    const fixture = { from: 'second' };
    registry.registerFixtures([
      fixtureSet('checkout', { [ERROR]: {} }, first),
      fixtureSet('checkout', { [SUCCESS]: fixture }, second),
    ]);
    const unregisterFirst = registry.register(fakeHandle({ source: first }));
    registry.register(fakeHandle({ instanceId: '2', source: second }));

    // A known limitation: the marker misses the fixture the second instance previews with.
    expect([...registry.getSnapshot().data.checkout.fixture]).toEqual([ERROR]);
    registry.preview('checkout#2', { leaves: [SUCCESS] });
    expect(registry.getOverride('checkout#2')).toMatchObject({ source: 'fixture', context: fixture });

    unregisterFirst();
    expect([...registry.getSnapshot().data.checkout.fixture]).toEqual([SUCCESS]);
  });

  test('hydration on register picks up recordings already in storage', () => {
    const stored = { from: 'storage' };
    storage.setItem(
      `${STORAGE_PREFIX}checkout`,
      JSON.stringify({ v: 1, entries: [{ leaves: [EXPRESS, ERROR], at: 1, context: stored }] }),
    );
    const registry = setup();
    registry.register(fakeHandle());

    expect([...registry.getSnapshot().data.checkout.recorded].sort()).toEqual([ERROR, EXPRESS]);
    registry.preview('checkout#1', { leaves: [ERROR] });
    expect(registry.getOverride('checkout#1')).toMatchObject({ source: 'recorded', context: stored });
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

describe('getRegistry', () => {
  type Scope = typeof globalThis & { [REGISTRY_KEY]?: Registry };

  // Fresh module state, so the once-per-copy version warning starts unsent.
  async function loadGetRegistry(): Promise<() => Registry> {
    vi.resetModules();
    return (await import('../../src/core/registry')).getRegistry;
  }

  afterEach(() => {
    delete (globalThis as Scope)[REGISTRY_KEY];
    sessionStorage.clear();
  });

  test('creates one registry and stores it on globalThis', async () => {
    const getRegistry = await loadGetRegistry();
    const registry = getRegistry();

    expect(getRegistry()).toBe(registry);
    expect((globalThis as Scope)[REGISTRY_KEY]).toBe(registry);
    expect(registry.version).toBe(VERSION);
    expect(registry.getSnapshot()).toEqual({ machines: [], overrides: {}, log: [], data: {} });
  });

  test('returns a registry another copy created first', async () => {
    const existing = setup();
    (globalThis as Scope)[REGISTRY_KEY] = existing;
    const getRegistry = await loadGetRegistry();

    expect(getRegistry()).toBe(existing);
    expect(getRegistry()).toBe(existing);
  });

  test('warns once when the existing registry has another version', async () => {
    const existing = { ...createNoopRegistry(), version: '9.9.9' };
    (globalThis as Scope)[REGISTRY_KEY] = existing;
    const getRegistry = await loadGetRegistry();

    expect(getRegistry()).toBe(existing);
    expect(getRegistry()).toBe(existing);
    const warnings = takeWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^\[state-viewer\] /);
    expect(warnings[0]).toContain(VERSION);
    expect(warnings[0]).toContain('9.9.9');
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
