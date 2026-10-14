// The XState adapter end to end: hooks and connect() against the page's real registry, with its recording and fixture
// stores, context resolution and child discovery. Every render runs under StrictMode (test/setup.ts).
import { act, render, screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import {
  assign,
  createActor,
  createMachine,
  sendTo,
  setup,
  spawnChild,
  type Actor,
  type ActorRefFrom,
  type AnyActorRef,
  type AnyStateMachine,
  type EventFrom,
} from 'xstate';
import { STORAGE_PREFIX } from '../../src/core/recording';
import { REGISTRY_KEY } from '../../src/core/registry';
import type { DataSource } from '../../src/core/types';
import {
  connect,
  defineFixtures,
  useActorRef,
  useMachine,
  type DebugOptions,
  type FixtureStates,
} from '../../src/xstate';
import { flush, handlesOf, keyOf, onlyHandle, registry, resetRegistry } from './helpers';

// ---------------------------------------------------------------------------------------------------------------------
// Machines

interface CheckoutContext {
  step: number;
  note: string;
}

/** A factory, so a test can make an equivalent machine object the way HMR does. Every transition counts a step. */
function createCheckoutMachine() {
  return setup({
    types: {
      context: {} as CheckoutContext,
      events: {} as
        | { type: 'START' }
        | { type: 'FAIL'; note: string }
        | { type: 'RETRY' }
        | { type: 'STANDARD' }
        | { type: 'EXPRESS' }
        | { type: 'PICKUP' }
        | { type: 'FINISH' },
    },
    actions: { count: assign({ step: ({ context }) => context.step + 1 }) },
  }).createMachine({
    id: 'checkout',
    context: { step: 0, note: 'none' },
    initial: 'idle',
    states: {
      idle: { on: { START: { target: 'paying', actions: 'count' } } },
      paying: {
        type: 'parallel',
        on: { FINISH: { target: 'done', actions: 'count' } },
        states: {
          card: {
            initial: 'idle',
            states: {
              idle: {
                on: { FAIL: { target: 'error', actions: ['count', assign({ note: ({ event }) => event.note })] } },
              },
              error: { on: { RETRY: { target: 'idle', actions: 'count' } } },
            },
          },
          shipping: {
            initial: 'standard',
            on: {
              STANDARD: { target: '.standard', actions: 'count' },
              EXPRESS: { target: '.express', actions: 'count' },
              PICKUP: { target: '.pickup', actions: 'count' },
            },
            states: { standard: {}, express: {}, pickup: {} },
          },
        },
      },
      done: { type: 'final' },
    },
  });
}

const checkoutMachine = createCheckoutMachine();
type CheckoutMachine = typeof checkoutMachine;
type CheckoutEvent = EventFrom<CheckoutMachine>;

const workerMachine = setup({
  types: { events: {} as { type: 'PAUSE' } | { type: 'FINISH' } },
}).createMachine({
  id: 'worker',
  initial: 'working',
  states: {
    working: { on: { PAUSE: 'paused', FINISH: 'finished' } },
    paused: {},
    finished: { type: 'final' },
  },
});

type ParentEvent = { type: 'OPEN' } | { type: 'CLOSE' } | { type: 'PAUSE_JOB' } | { type: 'FINISH_JOB' };

/** Invokes a worker as "job" while busy. */
const parentMachine = setup({
  types: { events: {} as ParentEvent },
  actors: { worker: workerMachine },
}).createMachine({
  id: 'parent',
  initial: 'idle',
  states: {
    idle: { on: { OPEN: 'busy' } },
    busy: {
      invoke: { id: 'job', src: 'worker', onDone: 'idle' },
      on: {
        CLOSE: 'idle',
        PAUSE_JOB: { actions: sendTo('job', { type: 'PAUSE' }) },
        FINISH_JOB: { actions: sendTo('job', { type: 'FINISH' }) },
      },
    },
  },
});

/** Invokes its worker in the initial state, so the child exists before the parent registers. */
const eagerParentMachine = setup({
  types: { events: {} as ParentEvent },
  actors: { worker: workerMachine },
}).createMachine({
  id: 'eager',
  initial: 'busy',
  states: {
    busy: {
      invoke: { id: 'job', src: 'worker' },
      on: { PAUSE_JOB: { actions: sendTo('job', { type: 'PAUSE' }) } },
    },
  },
});

const middleMachine = setup({ actors: { worker: workerMachine } }).createMachine({
  id: 'middle',
  initial: 'running',
  states: { running: { invoke: { id: 'inner-job', src: 'worker' } } },
});

/** Three levels: top invokes middle, which invokes a worker. */
const topMachine = setup({
  types: { events: {} as { type: 'OPEN' } },
  actors: { middle: middleMachine },
}).createMachine({
  id: 'top',
  initial: 'idle',
  states: {
    idle: { on: { OPEN: 'busy' } },
    busy: { invoke: { id: 'outer-job', src: 'middle' } },
  },
});

const spawnerMachine = setup({
  types: {
    context: {} as { workers: ActorRefFrom<typeof workerMachine>[] },
    events: {} as { type: 'SPAWN_CHILD' } | { type: 'ASSIGN_SPAWN' },
  },
  actors: { worker: workerMachine },
}).createMachine({
  id: 'spawner',
  context: { workers: [] },
  initial: 'running',
  states: {
    running: {
      on: {
        SPAWN_CHILD: { actions: spawnChild('worker', { id: 'spawned-job' }) },
        ASSIGN_SPAWN: {
          actions: assign({
            workers: ({ context, spawn }) => [...context.workers, spawn('worker', { id: 'assigned-job' })],
          }),
        },
      },
    },
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// Rendering

/** Lets a test reach the real actor behind a hook's proxy through XState's system, to send past a preview. */
const ROOT_SYSTEM_ID = 'root';

interface CheckoutProps {
  machine?: CheckoutMachine;
  debug?: DebugOptions;
  testId?: string;
  onActor?: (actor: Actor<CheckoutMachine>) => void;
}

function Checkout({ machine = checkoutMachine, debug, testId = 'checkout', onActor }: CheckoutProps) {
  const [snapshot, , actorRef] = useMachine(machine, { systemId: ROOT_SYSTEM_ID, debug });
  onActor?.(actorRef);
  return <output data-testid={testId}>{JSON.stringify({ value: snapshot.value, context: snapshot.context })}</output>;
}

interface Shown {
  value: unknown;
  context: CheckoutContext;
}

interface MountedCheckout {
  key: string;
  proxy: Actor<CheckoutMachine>;
  /** The snapshot the component rendered. */
  shown(): Shown;
  /** Sends through the proxy, as the app does; blocked while previewed. */
  send(event: CheckoutEvent): void;
  /** Sends to the real actor, which keeps running underneath a preview (R13). */
  sendToRealActor(event: CheckoutEvent): void;
  unmount(): void;
}

function shownBy(testId: string): Shown {
  return JSON.parse(screen.getByTestId(testId).textContent ?? 'null') as Shown;
}

/** Renders one checkout in its own root and returns it with the key of the handle it registered (the newest one). */
async function mountCheckout(props: Omit<CheckoutProps, 'onActor'> = {}): Promise<MountedCheckout> {
  const testId = props.testId ?? 'checkout';
  let proxy: Actor<CheckoutMachine> | undefined;
  const view = render(
    <Checkout
      {...props}
      onActor={(actor) => {
        proxy = actor;
      }}
    />,
  );
  await flush();
  const handles = handlesOf(props.debug?.id ?? (props.machine ?? checkoutMachine).id);
  const handle = handles[handles.length - 1];
  if (!proxy || !handle) throw new Error('The checkout did not render and register.');
  const actor = proxy;
  return {
    key: keyOf(handle),
    proxy: actor,
    shown: () => shownBy(testId),
    send: (event) => act(() => actor.send(event)),
    sendToRealActor: (event) =>
      act(() => {
        actor.system.get(ROOT_SYSTEM_ID).send(event);
      }),
    unmount: () => view.unmount(),
  };
}

function ActorHost({ logic, onActor }: { logic: AnyStateMachine; onActor: (actor: AnyActorRef) => void }) {
  onActor(useActorRef(logic));
  return null;
}

/** Renders a component holding `useActorRef(machine)`; returns the proxy and the key of its handle. */
async function mountActor(machine: AnyStateMachine) {
  let proxy: AnyActorRef | undefined;
  const view = render(
    <ActorHost
      logic={machine}
      onActor={(actor) => {
        proxy = actor;
      }}
    />,
  );
  await flush();
  if (!proxy) throw new Error('The actor host did not render.');
  const actor = proxy;
  return {
    proxy: actor,
    key: keyOf(onlyHandle(machine.id)),
    send: (event: { type: string }) => act(() => actor.send(event)),
    unmount: () => view.unmount(),
  };
}

function preview(key: string, leaves: string[], source?: DataSource): void {
  act(() => registry().preview(key, source === undefined ? { leaves } : { leaves, source }));
}

function release(key?: string): void {
  act(() => registry().release(key));
}

function data(machineId: string) {
  const availability = registry().getSnapshot().data[machineId];
  if (!availability) throw new Error(`No data for "${machineId}".`);
  return { recorded: [...availability.recorded].sort(), fixture: [...availability.fixture].sort() };
}

/** Keys of the registered handles, in registration order. */
function registeredKeys(): string[] {
  return registry().getSnapshot().machines.map(keyOf);
}

/** The live child actor under `id` in a parent's snapshot. */
function childOf(parent: AnyActorRef, id: string): AnyActorRef {
  const child = (parent.getSnapshot() as { children: Record<string, AnyActorRef | undefined> }).children[id];
  if (!child) throw new Error(`No child "${id}".`);
  return child;
}

/**
 * A page reload as far as the registry can tell: pending recordings are written to sessionStorage, which survives,
 * and the next getRegistry() creates a new registry. Unmount everything first.
 */
function reload(): void {
  window.dispatchEvent(new Event('pagehide'));
  delete (globalThis as Record<string, unknown>)[REGISTRY_KEY];
}

// ---------------------------------------------------------------------------------------------------------------------

let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;

/** Warnings logged so far, cleared, so afterEach only sees the unexpected ones. */
function takeWarnings(): string[] {
  const messages = warn.mock.calls.map(([message]) => String(message));
  warn.mockClear();
  return messages;
}

const liveFallbackWarning = (leaves: string, key: string) =>
  expect.stringContaining(`No recorded or fixture context for "${leaves}" on "${key}"`);

beforeEach(() => {
  // A registry from an earlier test can still have a debounced recordings write pending; pagehide makes every one of
  // them write now, so resetRegistry() clears it instead of the next registry hydrating it.
  window.dispatchEvent(new Event('pagehide'));
  resetRegistry();
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

describe('recording', () => {
  test('real transitions of a hook actor populate the recorded leaves of its machine id', async () => {
    const checkout = await mountCheckout();
    expect(data('checkout')).toEqual({ recorded: ['idle'], fixture: [] });

    checkout.send({ type: 'START' });
    await flush();
    expect(data('checkout').recorded).toEqual(['idle', 'paying.card.idle', 'paying.shipping.standard']);

    checkout.send({ type: 'FAIL', note: 'Card declined' });
    checkout.send({ type: 'EXPRESS' });
    await flush();
    expect(data('checkout').recorded).toEqual([
      'idle',
      'paying.card.error',
      'paying.card.idle',
      'paying.shipping.express',
      'paying.shipping.standard',
    ]);
  });

  test('previewing a visited leaf uses the recorded context of that visit, not the live one', async () => {
    const checkout = await mountCheckout();
    const initialContext = checkout.proxy.getSnapshot().context;
    checkout.send({ type: 'START' });
    checkout.send({ type: 'FAIL', note: 'Card declined' });
    const declinedContext = checkout.proxy.getSnapshot().context;
    checkout.send({ type: 'RETRY' });
    expect(checkout.shown().context).toEqual({ step: 3, note: 'Card declined' });

    preview(checkout.key, ['paying.card.error']);
    expect(registry().getOverride(checkout.key)).toMatchObject({
      requested: ['paying.card.error'],
      leaves: ['paying.card.error', 'paying.shipping.standard'],
      source: 'recorded',
    });
    // The very object the actor had then: recordings keep references, and assign replaces context.
    expect(registry().getOverride(checkout.key)?.context).toBe(declinedContext);
    expect(checkout.shown()).toEqual({
      value: { paying: { card: 'error', shipping: 'standard' } },
      context: { step: 2, note: 'Card declined' },
    });

    preview(checkout.key, ['idle']);
    expect(registry().getOverride(checkout.key)).toMatchObject({ source: 'recorded', leaves: ['idle'] });
    expect(registry().getOverride(checkout.key)?.context).toBe(initialContext);
    expect(checkout.shown()).toEqual({ value: 'idle', context: { step: 0, note: 'none' } });

    release(checkout.key);
    expect(checkout.shown()).toEqual({
      value: { paying: { card: 'idle', shipping: 'standard' } },
      context: { step: 3, note: 'Card declined' },
    });
  });

  test('an unvisited configuration takes the context of the newest recording containing the leaf', async () => {
    const checkout = await mountCheckout();
    checkout.send({ type: 'START' }); // card.idle + standard, step 1
    checkout.send({ type: 'FAIL', note: 'first' }); // card.error + standard, step 2
    checkout.send({ type: 'EXPRESS' }); // card.error + express, step 3
    checkout.send({ type: 'STANDARD' }); // card.error + standard again, step 4: now the newer of the two
    checkout.send({ type: 'RETRY' }); // card.idle + standard, step 5
    checkout.send({ type: 'PICKUP' }); // card.idle + pickup, step 6

    // card.error + pickup was never recorded, so the leaf alone picks the context.
    preview(checkout.key, ['paying.card.error']);
    expect(registry().getOverride(checkout.key)).toMatchObject({
      leaves: ['paying.card.error', 'paying.shipping.pickup'],
      source: 'recorded',
      context: { step: 4, note: 'first' },
    });
    expect(checkout.shown()).toEqual({
      value: { paying: { card: 'error', shipping: 'pickup' } },
      context: { step: 4, note: 'first' },
    });

    // An exact configuration still wins over a newer partial match.
    preview(checkout.key, ['paying.card.error', 'paying.shipping.express']);
    expect(registry().getOverride(checkout.key)).toMatchObject({ source: 'recorded', context: { step: 3 } });
  });

  test('the real actor keeps recording while it is previewed, and releasing shows where it got to', async () => {
    const checkout = await mountCheckout();
    preview(checkout.key, ['done']);
    expect(takeWarnings()).toEqual([liveFallbackWarning('done', checkout.key)]);
    expect(checkout.shown().value).toBe('done');

    // Neither the forced snapshot nor an event the preview blocked reaches the recordings.
    checkout.send({ type: 'START' });
    await flush();
    expect(registry().getSnapshot().log).toMatchObject([
      { instanceKey: checkout.key, event: { type: 'START' }, leaves: ['done'], blocked: true },
    ]);
    expect(data('checkout').recorded).toEqual(['idle']);

    checkout.sendToRealActor({ type: 'START' });
    checkout.sendToRealActor({ type: 'EXPRESS' });
    await flush();
    expect(data('checkout').recorded).toEqual([
      'idle',
      'paying.card.idle',
      'paying.shipping.express',
      'paying.shipping.standard',
    ]);
    // Live traffic doesn't move the preview.
    expect(checkout.shown()).toEqual({ value: 'done', context: { step: 0, note: 'none' } });
    expect(registry().getOverride(checkout.key)?.context).toEqual({ step: 0, note: 'none' });

    release(checkout.key);
    expect(checkout.shown()).toEqual({
      value: { paying: { card: 'idle', shipping: 'express' } },
      context: { step: 2, note: 'none' },
    });
  });

  test('recordings are kept per machine id, so one instance can preview what another visited', async () => {
    const first = await mountCheckout({ testId: 'first' });
    const second = await mountCheckout({ testId: 'second' });
    expect(registeredKeys()).toEqual([first.key, second.key]);

    first.send({ type: 'START' });
    first.send({ type: 'FAIL', note: 'seen by the first' });

    preview(second.key, ['paying.card.error']);
    expect(registry().getOverride(second.key)).toMatchObject({ source: 'recorded', context: { step: 2 } });
    expect(shownBy('second').context).toEqual({ step: 2, note: 'seen by the first' });
    expect(shownBy('first').value).toEqual({ paying: { card: 'error', shipping: 'standard' } });
  });

  test('a connect()ed actor records its transitions, including while it is previewed', async () => {
    const actor = createActor(checkoutMachine).start();
    const proxy = connect(actor, { id: 'checkout' });
    await flush();
    const key = keyOf(onlyHandle('checkout'));
    // The instance id comes from the page-wide counter, not the actor's session id.
    expect(key).toMatch(/^checkout#\d+$/);
    expect(data('checkout').recorded).toEqual(['idle']);

    actor.send({ type: 'START' });
    actor.send({ type: 'FAIL', note: 'declined' });
    const declined = actor.getSnapshot().context;
    await flush();
    expect(data('checkout').recorded).toEqual([
      'idle',
      'paying.card.error',
      'paying.card.idle',
      'paying.shipping.standard',
    ]);

    // The final snapshot is recorded before completing the actor unregisters it (connect() follows its lifetime).
    actor.send({ type: 'FINISH' });
    await flush();
    expect(registeredKeys()).toEqual([]);

    const next = createActor(checkoutMachine).start();
    const nextProxy = connect(next, { id: 'checkout' });
    await flush();
    const nextKey = keyOf(onlyHandle('checkout'));
    // Another actor draws the next id, so it doesn't share the finished one's key.
    expect(nextKey).toMatch(/^checkout#\d+$/);
    expect(nextKey).not.toBe(key);
    expect(data('checkout').recorded).toContain('done');
    preview(nextKey, ['paying.card.error']);
    expect(registry().getOverride(nextKey)?.context).toBe(declined);
    expect(nextProxy.getSnapshot().matches({ paying: { card: 'error' } })).toBe(true);

    next.send({ type: 'START' });
    next.send({ type: 'PICKUP' });
    await flush();
    expect(data('checkout').recorded).toContain('paying.shipping.pickup');
    expect(nextProxy.getSnapshot().context).toBe(declined);
    expect(proxy.getSnapshot().status).toBe('done');
    next.stop();
  });

  test('recordings persist to sessionStorage and feed previews after a reload (R17)', async () => {
    const before = await mountCheckout();
    before.send({ type: 'START' });
    before.send({ type: 'FAIL', note: 'Card declined' });
    before.send({ type: 'RETRY' });
    before.unmount();
    reload();
    expect(sessionStorage.getItem(`${STORAGE_PREFIX}checkout`)).not.toBeNull();

    const after = await mountCheckout();
    expect(data('checkout').recorded).toEqual([
      'idle',
      'paying.card.error',
      'paying.card.idle',
      'paying.shipping.standard',
    ]);
    preview(after.key, ['paying.card.error']);
    expect(registry().getOverride(after.key)).toMatchObject({
      source: 'recorded',
      context: { step: 2, note: 'Card declined' },
    });
    expect(after.shown()).toEqual({
      value: { paying: { card: 'error', shipping: 'standard' } },
      context: { step: 2, note: 'Card declined' },
    });
  });

  test('a context holding spawned actor refs is recorded in memory but never persisted (D14)', async () => {
    const spawner = await mountActor(spawnerMachine);
    spawner.send({ type: 'ASSIGN_SPAWN' });
    const withRef = spawner.proxy.getSnapshot().context;

    preview(spawner.key, ['running']);
    expect(registry().getOverride(spawner.key)).toMatchObject({ source: 'recorded' });
    expect(registry().getOverride(spawner.key)?.context).toBe(withRef);

    spawner.unmount();
    reload();
    expect(sessionStorage.getItem(`${STORAGE_PREFIX}spawner`)).toBeNull();
    // The child's own context is plain, so its recording is kept.
    expect(sessionStorage.getItem(`${STORAGE_PREFIX}worker`)).not.toBeNull();
  });
});

describe('fixtures', () => {
  const fixtureContext = (note: string): CheckoutContext => ({ step: 99, note });

  test('a leaf without a recording previews with its fixture; a recorded leaf prefers the recording', async () => {
    const set = defineFixtures(checkoutMachine, {
      idle: { context: fixtureContext('idle fixture') },
      done: { context: fixtureContext('done fixture') },
    });
    expect(set).toMatchObject({ machineId: 'checkout' });
    // The config, which machine.provide() copies share, rather than the machine object.
    expect(set.source).toBe(checkoutMachine.config);
    act(() => registry().registerFixtures([set]));
    const checkout = await mountCheckout();

    preview(checkout.key, ['done']);
    expect(registry().getOverride(checkout.key)).toMatchObject({ source: 'fixture', leaves: ['done'] });
    expect(registry().getOverride(checkout.key)?.context).toBe(set.states.done.context);
    expect(checkout.shown()).toEqual({ value: 'done', context: { step: 99, note: 'done fixture' } });
    expect(checkout.proxy.getSnapshot().status).toBe('done');

    // The initial state was recorded on mount, and recordings come first (R16).
    preview(checkout.key, ['idle']);
    expect(registry().getOverride(checkout.key)).toMatchObject({
      source: 'recorded',
      context: { step: 0, note: 'none' },
    });

    // Unless the fixture is asked for.
    preview(checkout.key, ['idle'], 'fixture');
    expect(registry().getOverride(checkout.key)).toMatchObject({
      source: 'fixture',
      context: { note: 'idle fixture' },
    });
  });

  test('data marks the leaves that have a fixture, whether fixtures register before or after the machine', async () => {
    act(() =>
      registry().registerFixtures([defineFixtures(checkoutMachine, { done: { context: fixtureContext('done') } })]),
    );
    await mountCheckout();
    expect(data('checkout')).toEqual({ recorded: ['idle'], fixture: ['done'] });

    act(() =>
      registry().registerFixtures([
        defineFixtures(checkoutMachine, { 'paying.card.error': { context: fixtureContext('declined') } }),
      ]),
    );
    await flush();
    // Sets for the same machine merge.
    expect(data('checkout')).toEqual({ recorded: ['idle'], fixture: ['done', 'paying.card.error'] });
  });

  test('a set matches by machine config when the hook registers the machine under debug.id', async () => {
    act(() =>
      registry().registerFixtures([
        defineFixtures(checkoutMachine, { done: { context: fixtureContext('by source') } }),
      ]),
    );
    const checkout = await mountCheckout({ debug: { id: 'checkout-v2' } });
    expect(checkout.key.startsWith('checkout-v2#')).toBe(true);
    expect(data('checkout-v2').fixture).toEqual(['done']);

    preview(checkout.key, ['done']);
    expect(registry().getOverride(checkout.key)).toMatchObject({ source: 'fixture', context: { note: 'by source' } });
    expect(checkout.shown().context.note).toBe('by source');
  });

  test('a set made for an equivalent machine object matches by machine id', async () => {
    // As after HMR: the set was made for another object, with its own config, under the same id.
    const recreated = createCheckoutMachine();
    act(() => registry().registerFixtures([defineFixtures(recreated, { done: { context: fixtureContext('by id') } })]));
    const checkout = await mountCheckout();
    expect(data('checkout').fixture).toEqual(['done']);

    preview(checkout.key, ['done']);
    expect(registry().getOverride(checkout.key)).toMatchObject({ source: 'fixture', context: { note: 'by id' } });
  });

  test('after HMR swaps the machine object, the instance keeps its key, preview and fixtures (D15)', async () => {
    act(() =>
      registry().registerFixtures([defineFixtures(checkoutMachine, { done: { context: fixtureContext('kept') } })]),
    );
    const view = render(<Checkout debug={{ id: 'checkout-v2' }} />);
    await flush();
    const key = keyOf(onlyHandle('checkout-v2'));
    preview(key, ['done']);
    expect(registry().getOverride(key)).toMatchObject({ source: 'fixture', context: { note: 'kept' } });

    // HMR re-renders the same component with a recreated machine; @xstate/react swaps in a new actor for it.
    const recreated = createCheckoutMachine();
    view.rerender(<Checkout machine={recreated} debug={{ id: 'checkout-v2' }} />);
    await flush();
    const handle = onlyHandle('checkout-v2');
    expect(handle.source).toBe(recreated.config);
    expect(keyOf(handle)).toBe(key);
    expect(registry().getOverride(key)).toMatchObject({ source: 'fixture', context: { note: 'kept' } });
    expect(shownBy('checkout')).toEqual({ value: 'done', context: { step: 99, note: 'kept' } });

    // The set names the old config and the id "checkout", yet still matches "checkout-v2" through its alias.
    expect(data('checkout-v2').fixture).toEqual(['done']);
    release(key);
    preview(key, ['done']);
    expect(registry().getOverride(key)).toMatchObject({ source: 'fixture', context: { note: 'kept' } });
  });

  test('after HMR swaps in a machine without the previewed state, the preview is released', async () => {
    function Machine({ logic }: { logic: AnyStateMachine }) {
      const [snapshot] = useMachine(logic);
      return <output data-testid="machine">{JSON.stringify(snapshot.value)}</output>;
    }
    const view = render(<Machine logic={checkoutMachine} />);
    await flush();
    const key = keyOf(onlyHandle('checkout'));
    preview(key, ['done']);
    expect(takeWarnings()).toEqual([liveFallbackWarning('done', key)]);
    expect(screen.getByTestId('machine').textContent).toBe('"done"');

    // Same id, but "done" was deleted while editing.
    const edited = createMachine({ id: 'checkout', initial: 'idle', states: { idle: {}, review: {} } });
    view.rerender(<Machine logic={edited} />);
    await flush();
    expect(onlyHandle('checkout').source).toBe(edited.config);
    expect(keyOf(onlyHandle('checkout'))).toBe(key);
    expect(registry().getOverride(key)).toBeUndefined();
    expect(screen.getByTestId('machine').textContent).toBe('"idle"');
    // Until the new handle registered, the proxy showed the real state instead of the stale preview.
    expect(takeWarnings()).toEqual([expect.stringContaining(`Can't show the preview of "${key}" on this actor`)]);
  });

  test("a set for another machine object doesn't reach an instance registered under a different id", async () => {
    const other = createCheckoutMachine();
    act(() => registry().registerFixtures([defineFixtures(other, { done: { context: fixtureContext('other') } })]));
    const checkout = await mountCheckout({ debug: { id: 'checkout-v2' } });
    expect(data('checkout-v2').fixture).toEqual([]);

    preview(checkout.key, ['done']);
    expect(takeWarnings()).toEqual([liveFallbackWarning('done', checkout.key)]);
    expect(registry().getOverride(checkout.key)?.source).toBe('live');
  });

  test('fixtures registering after a live preview re-resolve it to the fixture (R16, D13)', async () => {
    const first = await mountCheckout({ testId: 'first' });
    const second = await mountCheckout({ testId: 'second' });
    preview(first.key, ['done']);
    preview(second.key, ['done'], 'live');
    expect(takeWarnings()).toEqual([liveFallbackWarning('done', first.key)]);
    expect(registry().getOverride(first.key)).toMatchObject({ source: 'live', context: { step: 0, note: 'none' } });
    expect(shownBy('first')).toEqual({ value: 'done', context: { step: 0, note: 'none' } });

    // A lazy loader finishing after the preview was made.
    const set = defineFixtures(checkoutMachine, { done: { context: fixtureContext('loaded late') } });
    act(() => registry().registerFixtures([set]));

    expect(registry().getOverride(first.key)).toMatchObject({
      requested: ['done'],
      leaves: ['done'],
      source: 'fixture',
    });
    expect(registry().getOverride(first.key)?.context).toBe(set.states.done.context);
    expect(shownBy('first')).toEqual({ value: 'done', context: { step: 99, note: 'loaded late' } });
    // A source chosen explicitly is left alone.
    expect(registry().getOverride(second.key)).toMatchObject({ source: 'live', context: { note: 'none' } });
    expect(shownBy('second').context.note).toBe('none');

    await flush();
    expect(registry().getSnapshot().overrides[first.key]?.source).toBe('fixture');
  });

  test('later fixtures move a fixture preview, but not a recorded one or a live one they do not cover', async () => {
    act(() =>
      registry().registerFixtures([defineFixtures(checkoutMachine, { done: { context: fixtureContext('v1') } })]),
    );
    const onFixture = await mountCheckout({ testId: 'fixture' });
    const onRecording = await mountCheckout({ testId: 'recording' });
    const onLive = await mountCheckout({ testId: 'live' });
    preview(onFixture.key, ['done']);
    preview(onRecording.key, ['idle']);
    preview(onLive.key, ['paying.card.error']);
    expect(takeWarnings()).toEqual([liveFallbackWarning('paying.card.error', onLive.key)]);
    const recordedContext = registry().getOverride(onRecording.key)?.context;
    const liveContext = registry().getOverride(onLive.key)?.context;
    // The real actor moves on; the live preview keeps the context it captured.
    onLive.sendToRealActor({ type: 'START' });

    // A later set wins per leaf id; "idle" has a recording, which fixtures can't outrank.
    act(() =>
      registry().registerFixtures([
        defineFixtures(checkoutMachine, {
          done: { context: fixtureContext('v2') },
          idle: { context: fixtureContext('idle') },
        }),
      ]),
    );
    expect(registry().getOverride(onFixture.key)).toMatchObject({ source: 'fixture', context: { note: 'v2' } });
    expect(shownBy('fixture').context.note).toBe('v2');
    expect(registry().getOverride(onRecording.key)?.source).toBe('recorded');
    expect(registry().getOverride(onRecording.key)?.context).toBe(recordedContext);
    expect(registry().getOverride(onLive.key)?.source).toBe('live');
    expect(registry().getOverride(onLive.key)?.context).toBe(liveContext);
    expect(shownBy('live')).toEqual({
      value: { paying: { card: 'error', shipping: 'standard' } },
      context: { step: 0, note: 'none' },
    });
  });

  test("defineFixtures warns about keys that aren't leaf ids", () => {
    const states = {
      paying: { context: fixtureContext('compound') },
      'paying.card': { context: fixtureContext('region') },
      'paying.card.error': { context: fixtureContext('leaf') },
      missing: { context: fixtureContext('nothing') },
    } as FixtureStates<CheckoutMachine>;
    defineFixtures(checkoutMachine, states);
    const warnings = takeWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(
      'Fixtures for "checkout" name "paying", "paying.card", "missing", which aren\'t leaf states of the machine.',
    );

    defineFixtures(checkoutMachine, {
      'paying.card.error': { context: fixtureContext('leaf') },
      done: { context: fixtureContext('final') },
    });
    expect(takeWarnings()).toEqual([]);
  });

  test('defineFixtures on an anonymous machine uses the fallback id its instances register under', async () => {
    const anonymous = createMachine({
      types: {} as { context: { label: string } },
      context: { label: 'live' },
      initial: 'closed',
      states: { closed: { on: { OPEN: 'open' } }, open: {} },
    });
    expect(anonymous.id).toBe('(machine)');
    const set = defineFixtures(anonymous, { open: { context: { label: 'fixture' } } });
    expect(set.machineId).toMatch(/^machine-[0-9a-z]{7}$/);

    act(() => registry().registerFixtures([set]));
    render(<ActorHost logic={anonymous} onActor={() => {}} />);
    await flush();
    const handle = onlyHandle(set.machineId);
    // One warning, though StrictMode registers the instance twice.
    expect(takeWarnings()).toEqual([
      expect.stringContaining(`A machine has no id, so it's listed as "${set.machineId}"`),
    ]);
    expect(data(set.machineId).fixture).toEqual(['open']);

    preview(keyOf(handle), ['open']);
    expect(registry().getOverride(keyOf(handle))).toMatchObject({ source: 'fixture', context: { label: 'fixture' } });
  });

  test('an anonymous machine recreated with the same states gets the same fallback id and fixtures', async () => {
    // A new config object each time, as HMR re-running the module makes, so the set can only match by machine id.
    const createAnonymous = () =>
      createMachine({
        types: {} as { context: { label: string } },
        context: { label: 'live' },
        initial: 'a',
        states: { a: {}, b: {}, c: { type: 'final' } },
      });
    const original = createAnonymous();
    const recreated = createAnonymous();
    const set = defineFixtures(original, { c: { context: { label: 'from the original' } } });

    act(() => registry().registerFixtures([set]));
    render(<ActorHost logic={recreated} onActor={() => {}} />);
    await flush();
    const handle = onlyHandle(set.machineId);
    expect(handle.source).toBe(recreated.config);
    expect(handle.source).not.toBe(set.source);
    expect(takeWarnings()).toEqual([expect.stringContaining(`listed as "${set.machineId}"`)]);

    preview(keyOf(handle), ['c']);
    expect(registry().getOverride(keyOf(handle))).toMatchObject({
      source: 'fixture',
      context: { label: 'from the original' },
    });
  });
});

describe('live fallback (R19)', () => {
  test('a state with neither a recording nor a fixture previews with live context and a warning', async () => {
    const checkout = await mountCheckout();
    checkout.send({ type: 'START' });
    checkout.send({ type: 'EXPRESS' });
    await flush();
    // Unmarked in both sets.
    expect(data('checkout').recorded).not.toContain('done');
    expect(data('checkout').fixture).toEqual([]);

    preview(checkout.key, ['done']);
    expect(takeWarnings()).toEqual([liveFallbackWarning('done', checkout.key)]);
    expect(registry().getOverride(checkout.key)).toMatchObject({ source: 'live', leaves: ['done'] });
    expect(registry().getOverride(checkout.key)?.context).toBe(checkout.proxy.getSnapshot().context);
    expect(checkout.shown()).toEqual({ value: 'done', context: { step: 2, note: 'none' } });

    // Asking for live context explicitly isn't a fallback, so it doesn't warn.
    preview(checkout.key, ['done'], 'live');
    expect(takeWarnings()).toEqual([]);
  });
});

describe('parallel previews (R9)', () => {
  test('previewing one region keeps the current leaf of the other', async () => {
    const checkout = await mountCheckout();
    checkout.send({ type: 'START' });
    checkout.send({ type: 'EXPRESS' });

    preview(checkout.key, ['paying.card.error']);
    expect(takeWarnings()).toEqual([liveFallbackWarning('paying.card.error', checkout.key)]);
    expect(registry().getOverride(checkout.key)).toMatchObject({
      requested: ['paying.card.error'],
      leaves: ['paying.card.error', 'paying.shipping.express'],
    });
    expect(checkout.shown().value).toEqual({ paying: { card: 'error', shipping: 'express' } });
    expect(checkout.proxy.getSnapshot().matches({ paying: { shipping: 'express' } })).toBe(true);
  });

  test('from outside the parallel state, untouched regions start at their initial leaves', async () => {
    const checkout = await mountCheckout();

    preview(checkout.key, ['paying.shipping.pickup']);
    expect(takeWarnings()).toEqual([liveFallbackWarning('paying.shipping.pickup', checkout.key)]);
    expect(registry().getOverride(checkout.key)).toMatchObject({
      requested: ['paying.shipping.pickup'],
      leaves: ['paying.shipping.pickup', 'paying.card.idle'],
    });
    expect(checkout.shown().value).toEqual({ paying: { card: 'idle', shipping: 'pickup' } });
  });

  test('requested leaves keep the order given, and a leaf conflicting with an earlier one is dropped', async () => {
    const checkout = await mountCheckout();

    preview(checkout.key, ['paying.shipping.express', 'paying.card.error']);
    expect(registry().getOverride(checkout.key)).toMatchObject({
      requested: ['paying.shipping.express', 'paying.card.error'],
      leaves: ['paying.shipping.express', 'paying.card.error'],
    });
    expect(checkout.shown().value).toEqual({ paying: { card: 'error', shipping: 'express' } });

    preview(checkout.key, ['paying.card.error', 'paying.card.idle']);
    expect(registry().getOverride(checkout.key)).toMatchObject({
      requested: ['paying.card.error'],
      leaves: ['paying.card.error', 'paying.shipping.standard'],
    });
    expect(takeWarnings()).toEqual([
      liveFallbackWarning('paying.shipping.express, paying.card.error', checkout.key),
      liveFallbackWarning('paying.card.error', checkout.key),
    ]);
  });

  test('fixture lookup tries the requested leaves in order, then the filled-in ones (D11)', async () => {
    act(() =>
      registry().registerFixtures([
        defineFixtures(checkoutMachine, {
          'paying.card.error': { context: { step: 1, note: 'card error' } },
          'paying.shipping.standard': { context: { step: 1, note: 'standard shipping' } },
        }),
      ]),
    );
    // Sitting in idle, so nothing under paying is recorded.
    const checkout = await mountCheckout();
    const noteOf = (leaves: string[]) => {
      preview(checkout.key, leaves);
      const override = registry().getOverride(checkout.key);
      return [override?.source, (override?.context as CheckoutContext | undefined)?.note];
    };

    // Both leaves of the configuration have a fixture; the requested one wins.
    expect(noteOf(['paying.card.error'])).toEqual(['fixture', 'card error']);
    expect(noteOf(['paying.shipping.standard', 'paying.card.error'])).toEqual(['fixture', 'standard shipping']);
    expect(noteOf(['paying.card.error', 'paying.shipping.standard'])).toEqual(['fixture', 'card error']);
    // card.idle has none, so the filled-in shipping.standard supplies it.
    expect(noteOf(['paying.card.idle'])).toEqual(['fixture', 'standard shipping']);
    expect(registry().getOverride(checkout.key)?.leaves).toEqual(['paying.card.idle', 'paying.shipping.standard']);
    expect(checkout.shown().context.note).toBe('standard shipping');
  });
});

describe('child machines (R5)', () => {
  test('an invoked child is listed read-only under its parent while the invoking state is active', async () => {
    const parent = await mountActor(parentMachine);
    expect(registeredKeys()).toEqual([parent.key]);
    expect(onlyHandle('parent').capabilities).toEqual({ preview: true, live: false, children: true });

    parent.send({ type: 'OPEN' });
    await flush();
    const job = childOf(parent.proxy, 'job');
    const child = onlyHandle('worker');
    expect(child).toMatchObject({
      machineId: 'worker',
      instanceId: job.sessionId,
      label: 'job',
      parentKey: parent.key,
      adapter: 'xstate',
      capabilities: { preview: false, live: false, children: true },
    });
    expect(child.source).toBe(workerMachine.config);
    expect(registeredKeys()).toEqual([parent.key, keyOf(child)]);
    expect(child.getActiveLeaves()).toEqual(['working']);
    expect(data('worker').recorded).toEqual(['working']);

    // Read-only: the registry refuses to preview it.
    act(() => registry().preview(keyOf(child), { leaves: ['paused'] }));
    expect(takeWarnings()).toEqual([expect.stringContaining("its adapter doesn't support previews")]);
    expect(registry().getOverride(keyOf(child))).toBeUndefined();

    // The child's own transitions are recorded and reported.
    const onChange = vi.fn();
    child.subscribe(onChange);
    parent.send({ type: 'PAUSE_JOB' });
    await flush();
    expect(onChange).toHaveBeenCalled();
    expect(child.getActiveLeaves()).toEqual(['paused']);
    expect(data('worker').recorded).toEqual(['paused', 'working']);

    parent.send({ type: 'CLOSE' });
    await flush();
    expect(registeredKeys()).toEqual([parent.key]);
  });

  test('a child that reaches a final state is removed', async () => {
    const parent = await mountActor(parentMachine);
    parent.send({ type: 'OPEN' });
    await flush();
    expect(handlesOf('worker')).toHaveLength(1);

    parent.send({ type: 'FINISH_JOB' });
    await flush();
    expect(handlesOf('worker')).toEqual([]);
    expect(registeredKeys()).toEqual([parent.key]);
  });

  test('entering the invoking state again lists the new child, not the stopped one', async () => {
    const parent = await mountActor(parentMachine);
    parent.send({ type: 'OPEN' });
    const firstJob = childOf(parent.proxy, 'job');
    parent.send({ type: 'CLOSE' });
    parent.send({ type: 'OPEN' });
    await flush();
    const secondJob = childOf(parent.proxy, 'job');
    expect(secondJob).not.toBe(firstJob);
    expect(onlyHandle('worker').instanceId).toBe(secondJob.sessionId);
  });

  test('children spawned with spawnChild or with spawn inside assign are listed', async () => {
    const spawner = await mountActor(spawnerMachine);

    spawner.send({ type: 'SPAWN_CHILD' });
    await flush();
    expect(handlesOf('worker').map((handle) => [handle.label, handle.parentKey])).toEqual([
      ['spawned-job', spawner.key],
    ]);

    spawner.send({ type: 'ASSIGN_SPAWN' });
    await flush();
    expect(handlesOf('worker').map((handle) => [handle.label, handle.parentKey])).toEqual([
      ['spawned-job', spawner.key],
      ['assigned-job', spawner.key],
    ]);
    expect(handlesOf('worker').map((handle) => handle.instanceId)).toEqual([
      childOf(spawner.proxy, 'spawned-job').sessionId,
      childOf(spawner.proxy, 'assigned-job').sessionId,
    ]);
  });

  test('a grandchild is listed under its own parent, not the root', async () => {
    const top = await mountActor(topMachine);
    top.send({ type: 'OPEN' });
    await flush();

    const middle = onlyHandle('middle');
    const worker = onlyHandle('worker');
    expect(middle).toMatchObject({ parentKey: top.key, label: 'outer-job' });
    expect(worker).toMatchObject({ parentKey: keyOf(middle), label: 'inner-job' });
    expect(middle.instanceId).toBe(childOf(top.proxy, 'outer-job').sessionId);
  });

  test('children of a connect()ed actor are discovered, and leave with it', async () => {
    const actor = createActor(parentMachine).start();
    connect(actor, { id: 'service' });
    await flush();
    const parentKey = keyOf(onlyHandle('service'));

    actor.send({ type: 'OPEN' });
    await flush();
    expect(onlyHandle('worker')).toMatchObject({ parentKey, label: 'job', capabilities: { preview: false } });

    actor.stop();
    await flush();
    expect(registeredKeys()).toEqual([]);
  });

  test('a child already running when the parent registers is listed, for hooks and connect() alike', async () => {
    const hook = await mountActor(eagerParentMachine);
    expect(handlesOf('worker').map((handle) => handle.parentKey)).toEqual([hook.key]);

    const actor = createActor(eagerParentMachine).start();
    connect(actor, { id: 'eager-service' });
    await flush();
    expect(handlesOf('worker').map((handle) => handle.parentKey)).toEqual([
      hook.key,
      keyOf(onlyHandle('eager-service')),
    ]);
    actor.stop();
  });

  test('connect(createActor(machine)).start() lists the children once the actor starts', async () => {
    const proxy = connect(createActor(eagerParentMachine), { id: 'deferred' }).start();
    await flush();
    const parentKey = keyOf(onlyHandle('deferred'));
    expect(onlyHandle('worker')).toMatchObject({ parentKey, instanceId: childOf(proxy, 'job').sessionId });

    proxy.send({ type: 'PAUSE_JOB' });
    await flush();
    expect(onlyHandle('worker').getActiveLeaves()).toEqual(['paused']);
    proxy.stop();
    await flush();
    expect(registeredKeys()).toEqual([]);
  });

  test('each instance of a parent lists its own child', async () => {
    const first = await mountActor(parentMachine);
    let second: AnyActorRef | undefined;
    const secondView = render(
      <ActorHost
        logic={parentMachine}
        onActor={(actor) => {
          second = actor;
        }}
      />,
    );
    await flush();
    const [, secondHandle] = handlesOf('parent');
    if (!second || !secondHandle) throw new Error('The second parent did not register.');
    const secondProxy = second;

    act(() => {
      first.proxy.send({ type: 'OPEN' });
      secondProxy.send({ type: 'OPEN' });
    });
    await flush();
    expect(handlesOf('worker').map((handle) => [handle.parentKey, handle.instanceId])).toEqual([
      [first.key, childOf(first.proxy, 'job').sessionId],
      [keyOf(secondHandle), childOf(secondProxy, 'job').sessionId],
    ]);

    // Unmounting one parent takes only its own child along.
    secondView.unmount();
    await flush();
    expect(registeredKeys()).toEqual([first.key, `worker#${childOf(first.proxy, 'job').sessionId}`]);
  });

  test("a child survives StrictMode's double effects: listed once, in place, and still followed", async () => {
    const register = vi.spyOn(registry(), 'register');
    const parent = await mountActor(eagerParentMachine);
    // StrictMode ran the effects twice, so both handles registered twice.
    expect(register.mock.calls.map(([handle]) => handle.machineId)).toEqual(['eager', 'worker', 'eager', 'worker']);

    const root = onlyHandle('eager');
    const child = onlyHandle('worker');
    expect(registeredKeys()).toEqual([parent.key, keyOf(child)]);
    expect(child.instanceId).toBe(childOf(parent.proxy, 'job').sessionId);

    // One notification per real change: the first pass left no subscription or inspector behind.
    const rootChanged = vi.fn();
    const childChanged = vi.fn();
    root.subscribe(rootChanged);
    child.subscribe(childChanged);
    parent.send({ type: 'PAUSE_JOB' });
    await flush();
    expect(childChanged).toHaveBeenCalledTimes(1);
    expect(rootChanged).toHaveBeenCalledTimes(1);
    expect(child.getActiveLeaves()).toEqual(['paused']);
    expect(data('worker').recorded).toEqual(['paused', 'working']);

    parent.unmount();
    await flush();
    expect(registeredKeys()).toEqual([]);
  });
});

describe('StrictMode', () => {
  test('a preview made before the effect re-run survives it, and instances keep their registration order', async () => {
    const register = vi.spyOn(registry(), 'register');
    let firstPass = true;
    let late: AnyActorRef | undefined;

    // Runs once, in the first effect pass: after both checkouts registered, before StrictMode runs every cleanup and
    // setup again, as a preview applied at registration (a deep link) would.
    function PreviewSecondCheckout() {
      React.useEffect(() => {
        if (!firstPass) return;
        firstPass = false;
        const [, second] = handlesOf('checkout');
        registry().preview(keyOf(second), { leaves: ['paying.card.error'] });
        // Registers between the passes: a checkout that came back at the end would now be listed after it.
        late = connect(createActor(workerMachine).start(), { id: 'late' });
      }, []);
      return null;
    }

    render(
      <>
        <Checkout testId="first" />
        <Checkout testId="second" />
        <PreviewSecondCheckout />
      </>,
    );
    await flush();
    expect(register.mock.calls.filter(([handle]) => handle.machineId === 'checkout')).toHaveLength(4);

    const [first, second] = handlesOf('checkout');
    expect(registry().getSnapshot().machines.map((handle) => handle.machineId)).toEqual([
      'checkout',
      'checkout',
      'late',
    ]);
    expect(registry().getSnapshot().overrides[keyOf(second)]).toMatchObject({
      requested: ['paying.card.error'],
      leaves: ['paying.card.error', 'paying.shipping.standard'],
    });
    expect(registry().getOverride(keyOf(first))).toBeUndefined();
    expect(shownBy('second').value).toEqual({ paying: { card: 'error', shipping: 'standard' } });
    expect(shownBy('first').value).toBe('idle');
    expect(takeWarnings()).toEqual([liveFallbackWarning('paying.card.error', keyOf(second))]);
    late?.stop();
  });
});
