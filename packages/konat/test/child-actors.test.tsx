import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { Konat } from 'konat';
import { connect, useActorRef, useMachine, useSelector } from 'konat/xstate';
import { afterEach, describe, expect, onTestFinished, test } from 'vitest';
import {
  assign,
  createActor,
  forwardTo,
  fromCallback,
  sendTo,
  setup,
  spawnChild,
  type ActorRefFrom,
  type AnyActorRef,
  type AnyEventObject,
  type AnyMachineSnapshot,
  type AnyStateMachine,
} from 'xstate';
import { systemActor } from './support/app';
import {
  flush,
  freshId,
  instances,
  machines,
  marks,
  overlay,
  panel,
  preview,
  show,
  shownMachine,
} from './support/panel';
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

type ParentEvent = { type: 'OPEN' } | { type: 'CLOSE' } | { type: 'PROGRESS' } | { type: 'PAUSE' } | { type: 'FINISH' };

/** Invokes a worker as "job" while busy, and passes the worker's events on to it. It's idle again when the job ends. */
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
          FINISH: { actions: forwardTo('job') },
        },
      },
    },
  });
}

type ParentMachine = ReturnType<typeof createParentMachine>;

const PARENT_BUTTONS = {
  Open: 'OPEN',
  Close: 'CLOSE',
  Progress: 'PROGRESS',
  Pause: 'PAUSE',
  Finish: 'FINISH',
} satisfies Record<string, ParentEvent['type']>;

function Parent({ machine, label }: { machine: ParentMachine; label?: string }) {
  const [snapshot, send] = useMachine(machine, label === undefined ? undefined : { debug: { label } });

  return (
    <section aria-label={label ?? machine.id}>
      <output>{JSON.stringify(snapshot.value)}</output>
      {Object.entries(PARENT_BUTTONS).map(([text, type]) => (
        <button key={type} type="button" onClick={() => send({ type })}>
          {text}
        </button>
      ))}
      <button type="button" onClick={() => snapshot.children.job?.send({ type: 'FINISH' })}>
        Finish the job directly
      </button>
    </section>
  );
}

/** Renders the app next to an open overlay. `remove()` unmounts the app and keeps the overlay. */
async function mount(app: ReactElement) {
  const view = render(
    <>
      {app}
      <Konat defaultOpen />
    </>,
  );

  await flush();

  return {
    remove: () =>
      view.rerender(
        <>
          {null}
          <Konat defaultOpen />
        </>,
      ),
  };
}

function Hooked({ machine, onActor }: { machine: AnyStateMachine; onActor: (actor: AnyActorRef) => void }) {
  onActor(useActorRef(machine));

  return null;
}

/** An actor the app runs, and how the app ends it. */
interface Run {
  actor: AnyActorRef;
  stop: () => void;
}

/** The ways an app runs a machine: in a component, or outside React with connect(). The overlay is open. */
const RUNS = {
  useActorRef: async (machine: AnyStateMachine): Promise<Run> => {
    let actor: AnyActorRef | undefined;

    const { remove } = await mount(
      <Hooked
        machine={machine}
        onActor={(created) => {
          actor = created;
        }}
      />,
    );

    if (!actor) throw new Error('The component did not render.');

    return { actor, stop: remove };
  },
  'connect()': async (machine: AnyStateMachine): Promise<Run> => {
    await mount(<></>);
    const actor = connect(createActor(machine).start());
    onTestFinished(() => {
      actor.stop();
    });
    await flush();

    return { actor, stop: () => actor.stop() };
  },
  'connect() before start()': async (machine: AnyStateMachine): Promise<Run> => {
    await mount(<></>);
    const actor = connect(createActor(machine)).start();
    onTestFinished(() => {
      actor.stop();
    });
    await flush();

    return { actor, stop: () => actor.stop() };
  },
};

async function send(actor: AnyActorRef, event: AnyEventObject) {
  await act(async () => {
    actor.send(event);
  });
}

async function press(name: string, where?: string) {
  const scope = where === undefined ? screen : within(screen.getByRole('region', { name: where }));
  fireEvent.click(scope.getByRole('button', { name }));
  await flush();
}

function shown(name: string) {
  return JSON.parse(within(screen.getByRole('region', { name })).getByRole('status').textContent ?? 'null');
}

/** The live child under `id` in an actor's snapshot. */
function childOf(actor: AnyActorRef, id: string): AnyActorRef {
  const snapshot: AnyMachineSnapshot = actor.getSnapshot();
  const child = snapshot.children[id];

  if (!child) throw new Error(`No child "${id}".`);

  return child;
}

/** What the States section shows about the parent and the children of the shown instance. */
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

/** The recordings that a pagehide stored for the machine, without their times, oldest first. */
function storedEntries(machineId: string) {
  return readStored(machineId)?.entries.map(({ leaves, context }) => ({ leaves, context })) ?? null;
}

// The page keeps one registry for the file, and with it one timer for the delayed write.
// A pagehide writes what a test left pending, so the timer can't fire during a later test.
afterEach(hidePage);

test('an invoked child is listed under its parent while the invoking state is active, and the panel follows it', async () => {
  const worker = createWorkerMachine();
  const parent = createParentMachine(worker);
  await mount(<Parent machine={parent} />);

  const seen = () => {
    const { instance, live } = panel();

    return { instance, live, children: family().children };
  };

  const listed = await machines();
  await show(parent.id);
  const idle = { ...seen(), machines: listed };
  await press('Open');
  const busy = { ...seen(), machines: await machines() };
  await show(worker.id);
  const child = { ...seen(), marks: marks() };
  await press('Progress');
  await press('Pause');
  const paused = { ...seen(), context: panel().context, marks: marks() };
  await press('Close');
  const closed = { shown: shownMachine(), machines: await machines() };
  await press('Open');
  expect({ idle, busy, child, paused, closed, reopened: { shown: shownMachine(), ...seen() } }).toEqual({
    idle: { instance: `${parent.id} · 1`, live: ['idle'], children: [], machines: [parent.id] },
    busy: {
      instance: `${parent.id} · 1`,
      live: ['busy'],
      children: ['job · 1'],
      machines: [parent.id, `${worker.id} · child`],
    },
    child: {
      instance: 'job · 1',
      live: ['working'],
      children: [],
      marks: { working: ['recorded'], paused: ['none'], finished: ['none'] },
    },
    paused: {
      instance: 'job · 1',
      live: ['paused'],
      children: [],
      context: ['progress: 50'],
      marks: { working: ['recorded'], paused: ['recorded'], finished: ['none'] },
    },
    closed: { shown: 'none', machines: [parent.id] },
    reopened: { shown: worker.id, instance: 'job · 1', live: ['working'], children: [] },
  });
});

describe('children that an action spawns', () => {
  test('spawnChild and spawn in assign each list a child, named by its id', async () => {
    const worker = createWorkerMachine();

    type CrewContext = { workers: ActorRefFrom<WorkerMachine>[] };

    type CrewEvent = { type: 'SPAWN' } | { type: 'HIRE' };

    const crew = setup({
      // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
      types: { context: {} as CrewContext, events: {} as CrewEvent },
      actors: { worker },
    }).createMachine({
      id: freshId('crew'),
      context: { workers: [] },
      initial: 'running',
      states: {
        running: {
          on: {
            SPAWN: { actions: spawnChild('worker', { id: 'spawned' }) },
            HIRE: {
              actions: assign({
                workers: ({ context, spawn }) => [...context.workers, spawn('worker', { id: 'hired' })],
              }),
            },
          },
        },
      },
    });

    const { actor } = await RUNS.useActorRef(crew);

    await send(actor, { type: 'SPAWN' });
    const spawned = await machines();
    await send(actor, { type: 'HIRE' });
    await show(crew.id);
    const atCrew = { children: family().children, machines: await machines() };
    await show(worker.id, 2);
    expect({ spawned, atCrew, atHired: { instances: instances(), hint: family().hint } }).toEqual({
      spawned: [crew.id, `${worker.id} · child`],
      atCrew: { children: ['spawned · 1', 'hired · 2'], machines: [crew.id, `${worker.id} · child · 2 instances`] },
      atHired: { instances: ['spawned · 1', 'hired · 2'], hint: `Child of ${crew.id} · 1. ${READ_ONLY}` },
    });
  });
});

type TaskContext = { result: string };

type TaskEvent = { type: 'FINISH'; result: string };

/** A wizard invokes a step, which invokes a task. The task finishes on FINISH, and the step finishes with it. */
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
  test('a grandchild is listed under its own parent, not under the root', async () => {
    const { task, step, wizard } = createWizardMachines();
    await RUNS.useActorRef(wizard);

    await show(wizard.id);
    const atWizard = family();
    await show(step.id);
    const atStep = family();
    await show(task.id);
    expect({ atWizard, atStep, atTask: family(), machines: await machines() }).toEqual({
      atWizard: { hint: '', children: ['step · 1'] },
      atStep: { hint: `Child of ${wizard.id} · 1. ${READ_ONLY}`, children: ['task · 1'] },
      atTask: { hint: `Child of step · 1. ${READ_ONLY}`, children: [] },
      machines: [wizard.id, `${step.id} · child`, `${task.id} · child`],
    });
  });
});

describe("a child that the parent's initial state invokes", () => {
  test.each(Object.entries(RUNS))(
    'with %s, it is listed once and followed, the next child takes its place, and it leaves with the parent',
    async (_, run) => {
      const worker = createWorkerMachine();
      const parent = createParentMachine(worker, 'busy');
      const { actor, stop } = await run(parent);

      const atChild = async () => {
        const listed = await machines();
        await show(worker.id);

        return { machines: listed, instances: instances(), live: panel().live, hint: family().hint };
      };

      const running = await atChild();
      await send(actor, { type: 'PAUSE' });
      const paused = panel().live;
      await send(actor, { type: 'CLOSE' });
      const closed = await machines();
      await send(actor, { type: 'OPEN' });
      const reopened = await atChild();
      await act(async () => {
        stop();
      });
      await flush();

      const child = {
        machines: [parent.id, `${worker.id} · child`],
        instances: ['job · 1'],
        live: ['working'],
        hint: `Child of ${parent.id} · 1. ${READ_ONLY}`,
      };

      expect({ running, paused, closed, reopened, stopped: await machines() }).toEqual({
        running: child,
        paused: ['paused'],
        closed: [parent.id],
        reopened: child,
        stopped: [],
      });
    },
  );
});

describe('several instances of a parent', () => {
  test('each lists its own child, which leaves with it', async () => {
    const worker = createWorkerMachine();
    const parent = createParentMachine(worker);

    const app = (labels: string[]) => (
      <>
        {labels.map((label) => (
          <Parent key={label} machine={parent} label={label} />
        ))}
        <Konat defaultOpen />
      </>
    );

    const view = render(app(['First', 'Second']));
    await flush();
    await press('Open', 'First');
    await press('Open', 'Second');

    const atChild = async (nth: number) => {
      await show(worker.id, nth);

      return { instances: instances(), hint: family().hint };
    };

    const both = [await atChild(1), await atChild(2)];
    view.rerender(app(['First']));
    await flush();
    expect({ both, first: await atChild(1) }).toEqual({
      both: [
        { instances: ['job · 1', 'job · 2'], hint: `Child of First · 1. ${READ_ONLY}` },
        { instances: ['job · 1', 'job · 2'], hint: `Child of Second · 2. ${READ_ONLY}` },
      ],
      first: { instances: ['job · 1'], hint: `Child of First · 1. ${READ_ONLY}` },
    });
  });
});

describe('a child that finishes', () => {
  // The two ways reach konat in opposite orders. Through the parent, the child's last snapshot comes in first.
  // Told directly, the parent's move back to idle comes in first.
  test.each([
    ['through its parent', 'Finish'],
    ['by a component that holds it', 'Finish the job directly'],
  ])('leaves the list when it is told to finish %s, and its final state is recorded', async (_, button) => {
    const worker = createWorkerMachine();
    const parent = createParentMachine(worker);
    await mount(<Parent machine={parent} />);
    await press('Open');
    await press('Progress');

    await press(button);
    hidePage();
    expect({ parent: shown(parent.id), machines: await machines(), stored: storedEntries(worker.id) }).toEqual({
      parent: 'idle',
      machines: [parent.id],
      stored: [
        { leaves: ['working'], context: { progress: 50 } },
        { leaves: ['finished'], context: { progress: 100 } },
      ],
    });
  });

  // XState tells the parent that the grandchild is done, and the parent finishes and takes the grandchild out of the
  // tree before the grandchild's own last snapshot comes in.
  test.each([
    ['a grandchild whose finish ends its parent, under useActorRef', 'wizard', 'useActorRef'],
    ['a grandchild whose finish ends its parent, under connect()', 'wizard', 'connect()'],
    ['the child of a connect()ed actor that finishes with it', 'step', 'connect()'],
  ] as const)('%s, records its final state', async (_, root, run) => {
    const tree = createWizardMachines();
    const { actor } = await RUNS[run](tree[root]);

    await send(systemActor(actor, 'task'), { type: 'FINISH', result: 'shipped' });
    hidePage();
    expect({ machines: await machines(), stored: storedEntries(tree.task.id) }).toEqual({
      machines: root === 'wizard' ? [tree.wizard.id] : [],
      stored: [
        { leaves: ['running'], context: { result: 'none' } },
        { leaves: ['finished'], context: { result: 'shipped' } },
      ],
    });
  });
});

type TickerEvent = { type: 'TICK' };

type FlakyEvent = { type: 'POKE' };

type SupervisorEvent = { type: 'POKE' } | { type: 'RETRY' } | { type: 'START_BROKEN' };

/** A supervisor invokes a flaky child that fails on POKE, or a broken one that fails while it starts. */
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

  const flaky = setup({
    // SAFETY: XState reads the types of setup() only at compile time. It never reads this value.
    types: { events: {} as FlakyEvent },
    actors: { ticker },
    actions: {
      explode: () => {
        throw new Error('boom');
      },
    },
  }).createMachine({
    id: freshId('flaky'),
    initial: 'running',
    states: { running: { invoke: { id: 'inner', src: 'ticker' }, on: { POKE: { actions: 'explode' } } } },
  });

  const broken = setup({
    actors: { ticker },
    actions: {
      explode: () => {
        throw new Error('boom on start');
      },
    },
  }).createMachine({
    id: freshId('broken'),
    initial: 'running',
    states: { running: { entry: 'explode', invoke: { id: 'inner', src: 'ticker' } } },
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
  test('leaves the list with its own children, which stay off it while XState leaves them running', async () => {
    const { ticker, flaky, supervisor } = createSupervisorMachines();
    const { actor } = await RUNS.useActorRef(supervisor);
    const orphan = childOf(childOf(actor, 'job'), 'inner');

    const running = await machines();
    await send(actor, { type: 'POKE' });
    const failed = { value: actor.getSnapshot().value, machines: await machines() };
    await send(orphan, { type: 'TICK' });
    expect({ running, failed, ticked: { value: orphan.getSnapshot().value, machines: await machines() } }).toEqual({
      running: [supervisor.id, `${flaky.id} · child`, `${ticker.id} · child`],
      failed: { value: 'failed', machines: [supervisor.id] },
      ticked: { value: 'tock', machines: [supervisor.id] },
    });
  });

  test('a child that fails while it starts is never listed, nor is the child it started', async () => {
    const { supervisor, tickers } = createSupervisorMachines();
    const { actor } = await RUNS.useActorRef(supervisor);
    const before = tickers.length;

    await send(actor, { type: 'START_BROKEN' });
    const failed = { value: actor.getSnapshot().value, machines: await machines() };
    const orphans = tickers.slice(before);

    for (const orphan of orphans) await send(orphan, { type: 'TICK' });
    const ticked = { values: orphans.map((orphan) => orphan.getSnapshot().value), machines: await machines() };
    expect({ failed, ticked }).toEqual({
      failed: { value: 'failed', machines: [supervisor.id] },
      ticked: { values: ['tock'], machines: [supervisor.id] },
    });
  });

  test('after each retry, only the new child and its children are listed', async () => {
    const { ticker, flaky, supervisor } = createSupervisorMachines();
    const { actor } = await RUNS.useActorRef(supervisor);

    for (const type of ['POKE', 'RETRY', 'POKE', 'RETRY']) await send(actor, { type });

    const instancesOf = async (machineId: string) => {
      await show(machineId);

      return instances();
    };

    expect({
      machines: await machines(),
      flaky: await instancesOf(flaky.id),
      ticker: await instancesOf(ticker.id),
    }).toEqual({
      machines: [supervisor.id, `${flaky.id} · child`, `${ticker.id} · child`],
      flaky: ['job · 1'],
      ticker: ['inner · 1'],
    });
  });
});

type TimerEvent = { type: 'LAP' };

/** Parents of a child named "timer": one invokes it while active, the other spawns it when it starts. */
function createTimerParents() {
  // SAFETY: XState reads the types of setup() only at compile time. It never reads this value.
  const timer = setup({ types: { events: {} as TimerEvent } }).createMachine({
    id: freshId('timer'),
    initial: 'running',
    states: { running: { on: { LAP: 'lapped' } }, lapped: {} },
  });

  const invoker = setup({ actors: { timer } }).createMachine({
    id: freshId('invoker'),
    initial: 'active',
    states: {
      active: { tags: ['live'], invoke: { id: 'timer', src: 'timer' }, on: { PAUSE: 'paused' } },
      paused: { tags: ['idle'], on: { RESUME: 'active' } },
    },
  });

  const spawner = setup({ actors: { timer } }).createMachine({
    id: freshId('spawner'),
    entry: spawnChild('timer', { id: 'timer' }),
    initial: 'idle',
    states: {
      idle: { on: { WORK: 'busy' } },
      busy: { tags: ['working'], on: { REST: 'idle' } },
    },
  });

  return { invoker, spawner };
}

function Timer({ actor }: { actor: AnyActorRef }) {
  const value = useSelector(actor, (snapshot) => snapshot.value);

  return (
    <section aria-label="timer">
      <output>{JSON.stringify(value)}</output>
    </section>
  );
}

/** Shows what a component reads from the parent's snapshot, and renders the timer child that the snapshot holds. */
function Watcher({ actor }: { actor: AnyActorRef }) {
  const snapshot = useSelector(actor, (current) => current);

  const read = {
    value: snapshot.value,
    status: snapshot.status,
    matches: ['active', 'paused', 'idle', 'busy'].filter((state) => snapshot.matches(state)),
    tags: ['live', 'idle', 'working'].filter((tag) => snapshot.hasTag(tag)),
    can: ['PAUSE', 'RESUME', 'WORK', 'REST'].filter((type) => snapshot.can({ type })),
    children: Object.keys(snapshot.children),
  };

  const timer: AnyActorRef | undefined = snapshot.children.timer;

  return (
    <>
      <section aria-label="parent">
        <output>{JSON.stringify(read)}</output>
      </section>
      {timer && <Timer actor={timer} />}
    </>
  );
}

/** Starts the parent outside React, and shows it through connect(). Returns the real actor, to send past a preview. */
async function mountWatcher(machine: AnyStateMachine) {
  const actor = createActor(machine).start();
  onTestFinished(() => {
    actor.stop();
  });
  await mount(<Watcher actor={connect(actor)} />);

  return actor;
}

function timerShown() {
  return screen.queryByRole('region', { name: 'timer' }) ? shown('timer') : null;
}

describe('a child id that is not a string, as a JavaScript machine can give', () => {
  test('does not name the child, which is named by its machine', async () => {
    const worker = createWorkerMachine();

    const parent = setup({ actors: { worker } }).createMachine({
      id: freshId('parent'),
      // @ts-expect-error A JavaScript app can give a child a number as its id.
      invoke: { id: 7, src: 'worker' },
    });

    await RUNS.useActorRef(parent);
    await show(parent.id);
    const atParent = { children: family().children, machines: await machines() };
    await show(worker.id);
    expect({ atParent, atChild: { instances: instances(), hint: family().hint } }).toEqual({
      atParent: { children: [`${worker.id} · 1`], machines: [parent.id, `${worker.id} · child`] },
      atChild: { instances: [`${worker.id} · 1`], hint: `Child of ${parent.id} · 1. ${READ_ONLY}` },
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

    const { actor } = await RUNS.useActorRef(parent);
    await send(actor, { type: 'PING' });

    expect({ received, status: actor.getSnapshot().status }).toEqual({ received: [{ kind: 'ping' }], status: 'active' });
  });
});

describe('during a preview of the parent', () => {
  test.each([
    [
      'invokes',
      'invoker',
      'paused',
      { value: 'paused', status: 'active', matches: ['paused'], tags: ['idle'], can: ['RESUME'], children: ['timer'] },
    ],
    [
      'spawns',
      'spawner',
      'busy',
      { value: 'busy', status: 'active', matches: ['busy'], tags: ['working'], can: ['REST'], children: ['timer'] },
    ],
  ] as const)(
    'a parent that %s a child gives the component its live child, and the snapshot answers for the previewed state',
    async (_, kind, leaf, expected) => {
      const machine = createTimerParents()[kind];
      const actor = await mountWatcher(machine);

      await preview(machine.id, [leaf]);
      await send(childOf(actor, 'timer'), { type: 'LAP' });
      expect({ parent: shown('parent'), timer: timerShown() }).toEqual({ parent: expected, timer: 'lapped' });
    },
  );

  test('the component follows the live children as the real actor moves on', async () => {
    const { invoker } = createTimerParents();
    const actor = await mountWatcher(invoker);
    await preview(invoker.id, ['paused']);
    await send(childOf(actor, 'timer'), { type: 'LAP' });
    const seen = () => ({ value: shown('parent').value, children: shown('parent').children, timer: timerShown() });

    const lapped = seen();
    await send(actor, { type: 'PAUSE' });
    const paused = seen();
    await send(actor, { type: 'RESUME' });
    expect({ lapped, paused, resumed: seen() }).toEqual({
      lapped: { value: 'paused', children: ['timer'], timer: 'lapped' },
      paused: { value: 'paused', children: [], timer: null },
      resumed: { value: 'paused', children: ['timer'], timer: 'running' },
    });
  });

  test('a preview of a state that invokes a child starts no child', async () => {
    const { invoker } = createTimerParents();
    const actor = await mountWatcher(invoker);
    await send(actor, { type: 'PAUSE' });

    await preview(invoker.id, ['active']);
    expect({ parent: shown('parent'), timer: timerShown(), machines: await machines() }).toEqual({
      parent: { value: 'active', status: 'active', matches: ['active'], tags: ['live'], can: ['PAUSE'], children: [] },
      timer: null,
      machines: [`${invoker.id} · previewing`],
    });
  });
});
