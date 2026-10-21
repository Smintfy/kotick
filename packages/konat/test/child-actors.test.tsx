import { act, screen, within } from '@testing-library/react';
import { connect, useActorRef, useSelector } from 'konat/xstate';
import { describe, expect, test } from 'vitest';
import {
  assign,
  forwardTo,
  fromCallback,
  sendTo,
  setup,
  type AnyActorRef,
  type AnyEventObject,
  type AnyMachineSnapshot,
  type AnyStateMachine,
} from 'xstate';
import { mount, start, systemActor } from './support/app';
import { flush, freshId, instances, machines, overlay, panel, preview, show, shownMachine } from './support/panel';
import { readStored } from './support/recordings';

type WorkerContext = { progress: number };

type WorkerEvent = { type: 'PROGRESS' } | { type: 'PAUSE' } | { type: 'FINISH' };

function createWorkerMachine() {
  return setup({
    // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
    types: { context: {} as WorkerContext, events: {} as WorkerEvent },
  }).createMachine({
    id: freshId('worker'),
    context: { progress: 0 },
    initial: 'working',
    states: {
      working: {
        on: {
          PROGRESS: { actions: assign({ progress: ({ context }) => context.progress + 50 }) },
          PAUSE: 'paused',
          FINISH: { target: 'finished', actions: assign({ progress: 100 }) },
        },
      },
      paused: {},
      finished: { type: 'final' },
    },
  });
}

type WorkerMachine = ReturnType<typeof createWorkerMachine>;

type ParentEvent = { type: 'OPEN' } | { type: 'CLOSE' } | { type: 'PROGRESS' } | { type: 'PAUSE' };

function createParentMachine(worker: WorkerMachine, initial: 'idle' | 'busy' = 'idle') {
  return setup({
    // SAFETY: XState reads the types of setup() only at compile time. It never reads this value.
    types: { events: {} as ParentEvent },
    actors: { worker },
  }).createMachine({
    id: freshId('parent'),
    initial,
    states: {
      idle: { on: { OPEN: 'busy' } },
      busy: {
        invoke: { id: 'job', src: 'worker', onDone: 'idle' },
        on: {
          CLOSE: 'idle',
          PROGRESS: { actions: forwardTo('job') },
          PAUSE: { actions: forwardTo('job') },
        },
      },
    },
  });
}

function Hooked({ machine, onActor }: { machine: AnyStateMachine; onActor: (actor: AnyActorRef) => void }) {
  onActor(useActorRef(machine));

  return null;
}

/** Runs the machine in a component next to an open overlay, and returns the actor that useActorRef gives. */
async function run(machine: AnyStateMachine): Promise<AnyActorRef> {
  let actor: AnyActorRef | undefined;

  await mount(
    <Hooked
      machine={machine}
      onActor={(created) => {
        actor = created;
      }}
    />,
  );

  if (!actor) throw new Error('The component did not render.');

  return actor;
}

async function send(actor: AnyActorRef, event: AnyEventObject) {
  await act(async () => {
    actor.send(event);
  });
}

function shown(name: string) {
  return JSON.parse(within(screen.getByRole('region', { name })).getByRole('status').textContent ?? 'null');
}

function childOf(actor: AnyActorRef, id: string): AnyActorRef {
  const snapshot: AnyMachineSnapshot = actor.getSnapshot();
  const child = snapshot.children[id];

  if (!child) throw new Error(`No child "${id}".`);

  return child;
}

function family() {
  const states = [...overlay().querySelectorAll('section[aria-labelledby]')].find(
    (section) => section.querySelector('h3')?.textContent === 'States',
  );

  if (!states) throw new Error('The panel shows no States section.');

  return {
    hint: states.querySelector('p[data-part="hint"]')?.textContent ?? '',
    children: [...states.querySelectorAll('[data-part="children"] button')].map((button) => button.textContent),
  };
}

const READ_ONLY = 'Child machines are listed read-only.';

function hidePage() {
  window.dispatchEvent(new Event('pagehide'));
}

function storedEntries(machineId: string) {
  return readStored(machineId)?.entries.map(({ leaves, context }) => ({ leaves, context })) ?? null;
}

test('an invoked child is listed under its parent while the invoking state is active, and the panel follows it', async () => {
  const worker = createWorkerMachine();
  const parent = createParentMachine(worker);
  const actor = await run(parent);

  const seen = () => {
    const { instance, live } = panel();

    return { instance, live, children: family().children };
  };

  const listed = await machines();
  await show(parent.id);
  const idle = { ...seen(), machines: listed };
  await send(actor, { type: 'OPEN' });
  const busy = { ...seen(), machines: await machines() };
  await show(worker.id);
  const child = { ...seen(), hint: family().hint };
  await send(actor, { type: 'PROGRESS' });
  await send(actor, { type: 'PAUSE' });
  const paused = { live: panel().live, context: panel().context };
  await send(actor, { type: 'CLOSE' });
  expect({ idle, busy, child, paused, closed: { shown: shownMachine(), machines: await machines() } }).toEqual({
    idle: { instance: `${parent.id} · 1`, live: ['idle'], children: [], machines: [parent.id] },
    busy: {
      instance: `${parent.id} · 1`,
      live: ['busy'],
      children: ['job · 1'],
      machines: [parent.id, `${worker.id} · child`],
    },
    child: { instance: 'job · 1', live: ['working'], children: [], hint: `Child of ${parent.id} · 1. ${READ_ONLY}` },
    paused: { live: ['paused'], context: ['progress: 50'] },
    closed: { shown: 'none', machines: [parent.id] },
  });
});

type TaskContext = { result: string };

type TaskEvent = { type: 'FINISH'; result: string };

function createWizardMachines() {
  const task = setup({
    // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
    types: { context: {} as TaskContext, events: {} as TaskEvent },
  }).createMachine({
    id: freshId('task'),
    context: { result: 'none' },
    initial: 'running',
    states: {
      running: { on: { FINISH: { target: 'finished', actions: assign({ result: ({ event }) => event.result }) } } },
      finished: { type: 'final' },
    },
  });

  const step = setup({ actors: { task } }).createMachine({
    id: freshId('step'),
    initial: 'working',
    states: {
      working: { invoke: { id: 'task', systemId: 'task', src: 'task', onDone: 'complete' } },
      complete: { type: 'final' },
    },
  });

  const wizard = setup({ actors: { step } }).createMachine({
    id: freshId('wizard'),
    initial: 'stepping',
    states: {
      stepping: { invoke: { id: 'step', src: 'step', onDone: 'finished' } },
      finished: {},
    },
  });

  return { task, step, wizard };
}

describe('grandchildren', () => {
  // XState tells the parent that the grandchild is done.
  // The parent finishes and takes the grandchild out of the tree before the grandchild's own last snapshot comes in.
  test('a grandchild is listed under its own parent, and its final state is recorded when its finish ends its parent', async () => {
    const { task, step, wizard } = createWizardMachines();
    const actor = await run(wizard);

    await show(wizard.id);
    const atWizard = family();
    await show(step.id);
    const atStep = family();
    await show(task.id);
    const atTask = family();
    const listed = await machines();
    await send(systemActor(actor, 'task'), { type: 'FINISH', result: 'shipped' });
    hidePage();
    expect({ atWizard, atStep, atTask, listed, finished: await machines(), stored: storedEntries(task.id) }).toEqual({
      atWizard: { hint: '', children: ['step · 1'] },
      atStep: { hint: `Child of ${wizard.id} · 1. ${READ_ONLY}`, children: ['task · 1'] },
      atTask: { hint: `Child of step · 1. ${READ_ONLY}`, children: [] },
      listed: [wizard.id, `${step.id} · child`, `${task.id} · child`],
      finished: [wizard.id],
      stored: [
        { leaves: ['running'], context: { result: 'none' } },
        { leaves: ['finished'], context: { result: 'shipped' } },
      ],
    });
  });
});

describe('a child that finishes', () => {
  // Sent to the child directly, FINISH moves the parent back to idle before the child's own last snapshot comes in.
  test('leaves the list, and its final state is recorded', async () => {
    const worker = createWorkerMachine();
    const parent = createParentMachine(worker);
    const actor = await run(parent);
    await send(actor, { type: 'OPEN' });
    await send(actor, { type: 'PROGRESS' });

    await send(childOf(actor, 'job'), { type: 'FINISH' });
    hidePage();
    expect({ parent: actor.getSnapshot().value, machines: await machines(), stored: storedEntries(worker.id) }).toEqual({
      parent: 'idle',
      machines: [parent.id],
      stored: [
        { leaves: ['working'], context: { progress: 50 } },
        { leaves: ['finished'], context: { progress: 100 } },
      ],
    });
  });

  test('the child of a connect()ed actor that finishes with it, records its final state', async () => {
    const { task, step } = createWizardMachines();
    await mount(null);
    const actor = connect(start(step));
    await flush();

    await send(systemActor(actor, 'task'), { type: 'FINISH', result: 'shipped' });
    hidePage();
    expect({ machines: await machines(), stored: storedEntries(task.id) }).toEqual({
      machines: [],
      stored: [
        { leaves: ['running'], context: { result: 'none' } },
        { leaves: ['finished'], context: { result: 'shipped' } },
      ],
    });
  });
});

type TickerEvent = { type: 'TICK' };

type SupervisorEvent = { type: 'POKE' } | { type: 'RETRY' } | { type: 'START_BROKEN' };

function createSupervisorMachines() {
  // XState takes the children of a failed actor out of its tree and its system, so they put themselves here.
  const tickers: AnyActorRef[] = [];

  // SAFETY: XState reads the types of setup() only at compile time. It never reads this value.
  const ticker = setup({ types: { events: {} as TickerEvent } }).createMachine({
    id: freshId('ticker'),
    entry: ({ self }) => {
      tickers.push(self);
    },
    initial: 'tick',
    states: { tick: { on: { TICK: 'tock' } }, tock: { on: { TICK: 'tick' } } },
  });

  const explode = () => {
    throw new Error('boom');
  };

  const flaky = setup({ actors: { ticker } }).createMachine({
    id: freshId('flaky'),
    initial: 'running',
    states: { running: { invoke: { id: 'inner', src: 'ticker' }, on: { POKE: { actions: explode } } } },
  });

  const broken = setup({ actors: { ticker } }).createMachine({
    id: freshId('broken'),
    initial: 'running',
    states: { running: { entry: explode, invoke: { id: 'inner', src: 'ticker' } } },
  });

  const supervisor = setup({
    // SAFETY: XState reads the types of setup() only at compile time. It never reads this value.
    types: { events: {} as SupervisorEvent },
    actors: { flaky, broken },
  }).createMachine({
    id: freshId('supervisor'),
    initial: 'running',
    states: {
      running: {
        invoke: { id: 'job', src: 'flaky', onError: 'failed' },
        on: { POKE: { actions: sendTo('job', { type: 'POKE' }) }, START_BROKEN: 'trying' },
      },
      failed: { on: { RETRY: 'running' } },
      trying: { invoke: { id: 'broken-job', src: 'broken', onError: 'failed' } },
    },
  });

  return { ticker, flaky, supervisor, tickers };
}

describe('a child that fails', () => {
  test('leaves the list with its own children, which stay off it while XState leaves them running, also when it fails as it starts', async () => {
    const { ticker, flaky, supervisor, tickers } = createSupervisorMachines();
    const actor = await run(supervisor);
    const listed = [supervisor.id, `${flaky.id} · child`, `${ticker.id} · child`];
    const orphans = [childOf(childOf(actor, 'job'), 'inner')];

    const running = await machines();
    await send(actor, { type: 'POKE' });
    const failed = { value: actor.getSnapshot().value, machines: await machines() };
    await send(actor, { type: 'RETRY' });
    const retried: string[][] = [await machines()];

    for (const machineId of [flaky.id, ticker.id]) {
      await show(machineId);
      retried.push(instances());
    }

    const before = tickers.length;
    await send(actor, { type: 'START_BROKEN' });
    orphans.push(...tickers.slice(before));
    const failedOnStart = { value: actor.getSnapshot().value, machines: await machines() };

    for (const orphan of orphans) await send(orphan, { type: 'TICK' });
    const ticked = { values: orphans.map((orphan) => orphan.getSnapshot().value), machines: await machines() };
    expect({ running, failed, retried, failedOnStart, ticked }).toEqual({
      running: listed,
      failed: { value: 'failed', machines: [supervisor.id] },
      retried: [listed, ['job · 1'], ['inner · 1']],
      failedOnStart: { value: 'failed', machines: [supervisor.id] },
      ticked: { values: ['tock', 'tock'], machines: [supervisor.id] },
    });
  });
});

describe('an event without a string type, sent to a child', () => {
  test('reaches a callback child, and the parent keeps running', async () => {
    const received: AnyEventObject[] = [];

    const listener = fromCallback(({ receive }) => {
      receive((event) => {
        received.push(event);
      });
    });

    const parent = setup({ actors: { listener } }).createMachine({
      id: freshId('relay'),
      invoke: { id: 'listener', src: 'listener' },
      on: {
        // sendTo() with a child's id takes any object, and XState relays it to the child without a check.
        PING: { actions: sendTo('listener', { kind: 'ping' }) },
      },
    });

    const actor = await run(parent);
    await send(actor, { type: 'PING' });

    expect({ received, status: actor.getSnapshot().status }).toEqual({ received: [{ kind: 'ping' }], status: 'active' });
  });
});

type TimerEvent = { type: 'LAP' };

function createInvokerMachine() {
  // SAFETY: XState reads the types of setup() only at compile time. It never reads this value.
  const timer = setup({ types: { events: {} as TimerEvent } }).createMachine({
    id: freshId('timer'),
    initial: 'running',
    states: { running: { on: { LAP: 'lapped' } }, lapped: {} },
  });

  return setup({ actors: { timer } }).createMachine({
    id: freshId('invoker'),
    initial: 'active',
    states: {
      active: { invoke: { id: 'timer', src: 'timer' }, on: { PAUSE: 'paused' } },
      paused: { on: { RESUME: 'active' } },
    },
  });
}

function Timer({ actor }: { actor: AnyActorRef }) {
  const value = useSelector(actor, (snapshot) => snapshot.value);

  return (
    <section aria-label="timer">
      <output>{JSON.stringify(value)}</output>
    </section>
  );
}

function Watcher({ actor }: { actor: AnyActorRef }) {
  const snapshot = useSelector(actor, (current) => current);
  const timer: AnyActorRef | undefined = snapshot.children.timer;

  return (
    <>
      <section aria-label="parent">
        <output>{JSON.stringify({ value: snapshot.value, children: Object.keys(snapshot.children) })}</output>
      </section>
      {timer && <Timer actor={timer} />}
    </>
  );
}

async function mountWatcher(machine: AnyStateMachine) {
  const actor = start(machine);
  await mount(<Watcher actor={connect(actor)} />);

  return actor;
}

function seen() {
  return { parent: shown('parent'), timer: screen.queryByRole('region', { name: 'timer' }) ? shown('timer') : null };
}

describe('during a preview of the parent', () => {
  test('the component gets the live children as the real actor moves on', async () => {
    const invoker = createInvokerMachine();
    const real = await mountWatcher(invoker);
    await preview(invoker.id, ['paused']);
    await send(childOf(real, 'timer'), { type: 'LAP' });

    const lapped = seen();
    await send(real, { type: 'PAUSE' });
    const paused = seen();
    await send(real, { type: 'RESUME' });
    expect({ lapped, paused, resumed: seen() }).toEqual({
      lapped: { parent: { value: 'paused', children: ['timer'] }, timer: 'lapped' },
      paused: { parent: { value: 'paused', children: [] }, timer: null },
      resumed: { parent: { value: 'paused', children: ['timer'] }, timer: 'running' },
    });
  });

  test('a preview of a state that invokes a child starts no child', async () => {
    const invoker = createInvokerMachine();
    const real = await mountWatcher(invoker);
    await send(real, { type: 'PAUSE' });

    await preview(invoker.id, ['active']);
    expect({ ...seen(), machines: await machines() }).toEqual({
      parent: { value: 'active', children: [] },
      timer: null,
      machines: [`${invoker.id} · previewing`],
    });
  });
});
