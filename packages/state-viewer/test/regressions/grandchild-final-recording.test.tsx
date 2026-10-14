// A child machine that reaches its final state has its final configuration recorded before it leaves the registry, at
// any depth (spec §10.2 "Child discovery": each one's last snapshot is recorded first; §10.3, R17). That includes a
// grandchild whose finish ends its parent: XState relays the grandchild's done event to the parent, which finishes and
// takes the grandchild out of the tree, before the grandchild's own done snapshot reaches the inspector. It also
// includes the child of a connect()ed actor that finishes because its child finished: the root's done snapshot
// unregisters it, children included, before the child's own done snapshot comes in. Either way the final
// configuration is recorded, whether the app sends the event that finishes the grandchild straight to it (a component
// holding the child ref) or the grandchild finishes on its own timer, so another instance of the machine can preview
// that state with the context a real actor reached.

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  SimulatedClock,
  assign,
  createActor,
  sendTo,
  setup,
  type AnyActorRef,
  type AnyStateMachine,
  type InspectionEvent,
} from 'xstate';
import { connect, useActorRef } from '../../src/xstate';
import { flush, handlesOf, keyOf, registry, resetRegistry } from '../xstate/helpers';

/** Finishes on FINISH with the result it is sent, or on its own after a second with result 'timed'. */
const taskMachine = setup({
  types: {
    context: {} as { result: string },
    events: {} as { type: 'FINISH'; result: string },
  },
}).createMachine({
  id: 'task',
  context: { result: 'none' },
  initial: 'running',
  states: {
    running: {
      after: { 1000: { target: 'finished', actions: assign({ result: 'timed' }) } },
      on: { FINISH: { target: 'finished', actions: assign({ result: ({ event }) => event.result }) } },
    },
    finished: { type: 'final' },
  },
});

/** Invokes a task and finishes when it does. */
const stepMachine = setup({
  types: { events: {} as { type: 'FINISH'; result: string } },
  actors: { task: taskMachine },
}).createMachine({
  id: 'step',
  initial: 'working',
  states: {
    working: {
      invoke: { id: 'task', src: 'task', onDone: 'complete' },
      on: { FINISH: { actions: sendTo('task', ({ event }) => event) } },
    },
    complete: { type: 'final' },
  },
});

/** Invokes a step and moves on when it finishes. */
const wizardMachine = setup({
  types: { events: {} as { type: 'FINISH'; result: string } },
  actors: { step: stepMachine },
}).createMachine({
  id: 'wizard',
  initial: 'stepping',
  states: {
    stepping: {
      invoke: { id: 'step', src: 'step', onDone: 'finished' },
      on: { FINISH: { actions: sendTo('step', ({ event }) => event) } },
    },
    finished: {},
  },
});

/** Drives the actors' timers; idle instances get their own, which never moves. */
let clock: SimulatedClock;

/** The ways the task finishes without its parent sending it anything, and the result it finishes with. */
const FINISHES: [name: string, finish: (task: AnyActorRef) => void, result: string][] = [
  ['the app sends FINISH straight to it', (task) => task.send({ type: 'FINISH', result: 'shipped' }), 'shipped'],
  ['its own timer fires', () => clock.increment(1000), 'timed'],
];

const stoppable: AnyActorRef[] = [];

/** The order in which the system's inspectors see the task's done snapshot and its parent's. */
const endings: string[] = [];

function inspect(event: InspectionEvent): void {
  if (event.type !== '@xstate.snapshot') return;
  if ((event.snapshot as { status?: string }).status !== 'done') return;
  const logic = (event.actorRef as { logic?: unknown }).logic;
  if (logic === taskMachine) endings.push('task done');
  if (logic === stepMachine) endings.push('step done');
}

function childOf(parent: AnyActorRef, id: string): AnyActorRef {
  const child = (parent.getSnapshot() as { children: Record<string, AnyActorRef | undefined> }).children[id];
  if (!child) throw new Error(`No child "${id}".`);
  return child;
}

function connectRoot(machine: AnyStateMachine): AnyActorRef {
  const root = connect(createActor(machine, { clock, inspect }).start() as AnyActorRef);
  stoppable.push(root);
  return root;
}

/** Tasks listed under a parent: the ones running in the tree under test. */
const nestedTasks = () => handlesOf('task').filter((handle) => handle.parentKey !== undefined);

function recordedLeaves(machineId: string): string[] {
  const availability = registry().getSnapshot().data[machineId];
  return availability ? [...availability.recorded].sort() : [];
}

/**
 * Connects an idle instance of `machine`, so its recordings show in the registry's data, and previews `leaf` on it, as
 * someone in the panel would. Returns the override the preview shows.
 */
function previewOnIdle(machine: AnyStateMachine, leaf: string) {
  const idle = connect(createActor(machine, { clock: new SimulatedClock() }).start() as AnyActorRef, { label: 'idle' });
  stoppable.push(idle);
  const handle = handlesOf(machine.id).find((candidate) => candidate.label === 'idle');
  if (!handle) throw new Error(`The idle "${machine.id}" did not register.`);
  const key = keyOf(handle);
  act(() => registry().preview(key, { leaves: [leaf] }));
  return registry().getOverride(key);
}

/** The task's final configuration was recorded, with the context the real task reached. */
function expectTaskFinalRecorded(result: string): void {
  expect(previewOnIdle(taskMachine, 'finished')).toMatchObject({ source: 'recorded', context: { result } });
  expect(recordedLeaves('task')).toEqual(['finished', 'running']);
}

beforeEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  resetRegistry();
  clock = new SimulatedClock();
  endings.length = 0;
  // Previews of states without a recording or fixture warn about falling back to live context.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const actor of stoppable.splice(0)) actor.stop();
  vi.restoreAllMocks();
});

describe('a grandchild whose finish ends its parent', () => {
  test('control: finishing it through the root records its final configuration', async () => {
    const wizard = connectRoot(wizardMachine);
    await flush();
    expect(nestedTasks()).toHaveLength(1);

    wizard.send({ type: 'FINISH', result: 'shipped' });
    await flush();
    expect(wizard.getSnapshot().value).toBe('finished');
    expect(nestedTasks()).toEqual([]);
    // The task's done snapshot came in before its step's.
    expect(endings).toEqual(['task done', 'step done']);

    expectTaskFinalRecorded('shipped');
  });

  /** Mounts the wizard with useActorRef and returns its proxy. */
  async function mountWizard(): Promise<AnyActorRef> {
    let proxy: AnyActorRef | undefined;
    function Wizard() {
      proxy = useActorRef(wizardMachine, { clock, inspect });
      return null;
    }
    render(<Wizard />);
    await flush();
    if (!proxy) throw new Error('The wizard did not render.');
    return proxy;
  }

  const ROOTS: [name: string, start: () => Promise<AnyActorRef>][] = [
    ['connect()', async () => connectRoot(wizardMachine)],
    ['useActorRef', mountWizard],
  ];

  describe.each(ROOTS)('under a %s root', (_root, start) => {
    test.each(FINISHES)('records its final configuration when %s', async (_finish, finish, result) => {
      const wizard = await start();
      await flush();
      expect(nestedTasks()).toHaveLength(1);
      const task = childOf(childOf(wizard, 'step'), 'task');

      act(() => finish(task));
      await flush();
      expect(task.getSnapshot()).toMatchObject({ status: 'done', value: 'finished', context: { result } });
      expect(wizard.getSnapshot().value).toBe('finished');
      expect(nestedTasks()).toEqual([]);
      // The step finished, with the task already done, before the task's own done snapshot came in.
      expect(endings).toEqual(['step done', 'task done']);

      expectTaskFinalRecorded(result);
    });
  });
});

describe('a connect()ed actor that finishes because its child finished', () => {
  test('control: finishing the child through the root records its final configuration', async () => {
    const step = connectRoot(stepMachine);
    await flush();
    expect(nestedTasks()).toHaveLength(1);

    step.send({ type: 'FINISH', result: 'shipped' });
    await flush();
    expect(step.getSnapshot().status).toBe('done');
    expect(handlesOf('step')).toEqual([]);
    // The task's done snapshot came in before the root's.
    expect(endings).toEqual(['task done', 'step done']);

    expectTaskFinalRecorded('shipped');
  });

  test.each(FINISHES)('records the child final configuration when %s', async (_finish, finish, result) => {
    const step = connectRoot(stepMachine);
    await flush();
    expect(nestedTasks()).toHaveLength(1);
    const task = childOf(step, 'task');

    act(() => finish(task));
    await flush();
    expect(task.getSnapshot()).toMatchObject({ status: 'done', value: 'finished', context: { result } });
    expect(step.getSnapshot().status).toBe('done');
    // The root unregistered, and its child with it.
    expect(handlesOf('step')).toEqual([]);
    expect(nestedTasks()).toEqual([]);
    // The root finished, with the task already done, before the task's own done snapshot came in.
    expect(endings).toEqual(['step done', 'task done']);

    expectTaskFinalRecorded(result);
  });
});
