// The XState adapter end to end: hooks and connect() against the page's real registry, with its recording and fixture
// stores, context resolution and child discovery. Every render runs under StrictMode (test/setup.ts).
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { assign, createActor, sendTo, setup, spawnChild, type ActorRefFrom, type AnyActorRef, type AnyStateMachine } from 'xstate';
import { connect, useActorRef } from '../../src/xstate';
import { flush, handlesOf, keyOf, onlyHandle, registry, resetRegistry } from './helpers';

// ---------------------------------------------------------------------------------------------------------------------
// Machines

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

// ---------------------------------------------------------------------------------------------------------------------

let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;

/** Warnings logged so far, cleared, so afterEach only sees the unexpected ones. */
function takeWarnings(): string[] {
  const messages = warn.mock.calls.map(([message]) => String(message));
  warn.mockClear();
  return messages;
}

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

describe('child machines', () => {
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
