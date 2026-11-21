import { act } from '@testing-library/react';
import { connect, defineFixtures, useActorRef } from 'kotick/xstate';
import { describe, expect, test } from 'vitest';
import {
  Actor,
  assign,
  createMachine,
  setup,
  toPromise,
  waitFor,
  type AnyActorRef,
  type AnyStateMachine,
  type EventFrom,
  type SnapshotFrom,
} from 'xstate';
import { mount, start } from '../support/app';
import { errorMessage, uncaught } from '../support/console';
import { clickLeaf, flush, freshId, preview, release } from '../support/panel';

type CheckoutContext = { items: number };

type CheckoutEvent = { type: 'ADD' } | { type: 'PAY' } | { type: 'SUCCEED' } | { type: 'NOOP' };

function createCheckoutMachine() {
  return setup({
    // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
    types: { context: {} as CheckoutContext, events: {} as CheckoutEvent },
    guards: { hasItems: ({ context }) => context.items > 0 },
  }).createMachine({
    id: freshId('checkout'),
    context: { items: 0 },
    initial: 'cart',
    states: {
      cart: {
        on: {
          ADD: { actions: assign({ items: ({ context }) => context.items + 1 }) },
          PAY: { guard: 'hasItems', target: 'payment' },
        },
      },
      payment: {
        initial: 'pending',
        states: {
          pending: { on: { SUCCEED: '#paid' } },
          error: {},
        },
      },
      paid: { id: 'paid', type: 'final' },
    },
  });
}

type CheckoutMachine = ReturnType<typeof createCheckoutMachine>;

type Checkout = Actor<CheckoutMachine>;

type ResultContext = { result: number };

type JobEvent = { type: 'FINISH' };

function createJobMachine() {
  return setup({
    // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
    types: { context: {} as ResultContext, events: {} as JobEvent },
  }).createMachine({
    id: freshId('job'),
    context: { result: 0 },
    initial: 'running',
    states: {
      running: { on: { FINISH: { target: 'finished', actions: assign({ result: 42 }) } } },
      waiting: {},
      finished: { type: 'final' },
      cancelled: { type: 'final' },
    },
    output: ({ context }) => context.result,
  });
}

async function send(actor: Checkout, ...events: EventFrom<CheckoutMachine>[]) {
  await act(async () => {
    for (const event of events) actor.send(event);
  });
}

async function tick(): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

function summary(snapshot: SnapshotFrom<CheckoutMachine>): string {
  return `${JSON.stringify(snapshot.value)} ${snapshot.context.items}`;
}

function read(actor: AnyActorRef) {
  const { status, value, output } = actor.getSnapshot();

  return { status, value, output };
}

function outcome(promise: Promise<unknown>): () => string {
  let settled = 'pending';
  void promise.then(
    (value) => {
      settled = `resolved ${String(value)}`;
    },
    (error: Error) => {
      settled = `rejected ${error.message}`;
    },
  );

  return () => settled;
}

function waitForFinished(job: AnyActorRef): () => string {
  const finished = waitFor(job, (snapshot) => snapshot.matches('finished'));

  return outcome(finished.then((snapshot) => `${snapshot.status} ${snapshot.output}`));
}

function observe(job: AnyActorRef): string[] {
  const calls: string[] = [];
  job.subscribe({
    next: (snapshot) => calls.push(`next ${snapshot.status} ${String(snapshot.value)}`),
    complete: () => calls.push('complete'),
  });

  return calls;
}

function observeUntilDone(job: AnyActorRef): string[] {
  const calls: string[] = [];

  const subscription = job.subscribe({
    next: (snapshot) => {
      calls.push(`next ${snapshot.status}`);

      if (snapshot.status === 'done') subscription.unsubscribe();
    },
    complete: () => calls.push('complete'),
  });

  return calls;
}

type Run = { job: AnyActorRef; finishReal: () => void; end: () => Promise<void> };

/**
 * connect() unlists the finished actor, and the overlay drops it and its preview at its next flush.
 * A hook keeps the finished actor listed until the developer releases the preview.
 */
const OWNERS: [owner: string, end: string, run: (machine: AnyStateMachine) => Promise<Run>][] = [
  [
    'a connected actor',
    'the overlay drops it',
    async (machine) => {
      const actor = start(machine);
      const job = connect(actor);
      await mount(null);

      return { job, finishReal: () => actor.send({ type: 'FINISH' }), end: flush };
    },
  ],
  [
    'a hook actor',
    'the preview is released',
    async (machine) => {
      let job: AnyActorRef | undefined;

      function Job() {
        job = useActorRef(machine, { systemId: 'job' });

        return null;
      }

      await mount(<Job />);

      if (!job) throw new Error('The job did not render.');

      return {
        job,
        finishReal: () => job!.system.get('job')?.send({ type: 'FINISH' }),
        end: () => release(machine.id),
      };
    },
  ],
];

describe('subscribing to the actor that connect() returns', () => {
  test('without a preview, a subscriber gets each snapshot that the actor sends, repeats included, then complete', async () => {
    const machine = createCheckoutMachine();
    const actor = start(machine);
    const checkout = connect(actor);
    const real: SnapshotFrom<CheckoutMachine>[] = [];
    const proxied: SnapshotFrom<CheckoutMachine>[] = [];
    const ended: string[] = [];
    actor.subscribe((snapshot) => real.push(snapshot));
    checkout.subscribe(
      (snapshot) => proxied.push(snapshot),
      () => ended.push('error'),
      () => ended.push('complete'),
    );

    // NOOP changes nothing, and XState sends the same snapshot again.
    await send(checkout, { type: 'ADD' }, { type: 'NOOP' }, { type: 'PAY' }, { type: 'SUCCEED' });
    const same = proxied.map((snapshot, index) => snapshot === real[index]);
    expect({ proxied: proxied.map(summary), same, ended }).toEqual({
      proxied: ['"cart" 1', '"cart" 1', '{"payment":"pending"} 1', '"paid" 1'],
      same: [true, true, true, true],
      ended: ['complete'],
    });
  });

  test('a subscriber hears each change of the preview, also to the leaves the actor is in, and the release', async () => {
    const machine = createCheckoutMachine();
    const checkout = connect(start(machine));
    const calls: string[] = [];
    checkout.subscribe((snapshot) => calls.push(summary(snapshot)));
    await mount(null);

    await preview(machine.id, ['cart']);
    await clickLeaf('payment.error');
    await release(machine.id);
    expect(calls).toEqual(['"cart" 0', '{"payment":"error"} 0', '"cart" 0']);
  });

  test('during a preview, subscribers get the previewed snapshot once, and the real one only on release', async () => {
    const machine = createCheckoutMachine();
    const actor = start(machine);
    const checkout = connect(actor);
    const early: string[] = [];
    const late: string[] = [];
    checkout.subscribe((snapshot) => early.push(summary(snapshot)));
    await mount(null);

    await preview(machine.id, ['payment.error']);
    checkout.subscribe((snapshot) => late.push(summary(snapshot)));
    await send(actor, { type: 'ADD' }, { type: 'NOOP' }, { type: 'PAY' });
    const previewing = { early: [...early], late: [...late] };
    await release(machine.id);
    expect({ previewing, released: { early, late } }).toEqual({
      previewing: { early: ['{"payment":"error"} 0'], late: ['{"payment":"error"} 0'] },
      released: {
        early: ['{"payment":"error"} 0', '{"payment":"pending"} 1'],
        late: ['{"payment":"error"} 0', '{"payment":"pending"} 1'],
      },
    });
  });

  test('unsubscribe() ends real updates and previews, and a second call leaves a later subscription of the same function alone', async () => {
    const machine = createCheckoutMachine();
    const checkout = connect(start(machine));
    const calls: string[] = [];
    const listener = (snapshot: SnapshotFrom<CheckoutMachine>) => calls.push(summary(snapshot));
    await mount(null);

    const first = checkout.subscribe(listener);
    first.unsubscribe();
    await send(checkout, { type: 'ADD' });
    const second = checkout.subscribe(listener);
    first.unsubscribe();
    await preview(machine.id, ['payment.error']);
    await release(machine.id);
    second.unsubscribe();
    await preview(machine.id, ['payment.error']);
    expect(calls).toEqual(['{"payment":"error"} 1', '"cart" 1']);
  });

  test('an actor stopped during a preview completes its subscribers, and sends them no snapshot', async () => {
    const machine = createCheckoutMachine();
    const actor = start(machine);
    const checkout = connect(actor);

    const observe = (calls: string[]) =>
      checkout.subscribe({
        next: (snapshot) => calls.push(`next ${summary(snapshot)}`),
        complete: () => calls.push('complete'),
      });

    const early: string[] = [];
    const late: string[] = [];
    observe(early);
    await mount(null);

    await preview(machine.id, ['payment.error']);
    observe(late);
    await act(async () => {
      actor.stop();
    });
    expect({ early, late }).toEqual({ early: ['next {"payment":"error"} 0', 'complete'], late: ['complete'] });
  });
});

describe('an error in the actor', () => {
  function startFaulty() {
    const machine = createMachine({
      id: freshId('faulty'),
      initial: 'idle',
      states: {
        idle: {
          on: {
            BOOM: {
              actions: () => {
                throw new Error('boom');
              },
            },
          },
        },
      },
    });

    return start(machine);
  }

  const messages = (errors: unknown[]) => errors.map(errorMessage);

  // XState reports an error as uncaught unless each observer of the actor has an error callback.
  // connect() adds no observer, so the observers of the app decide, as without connect().
  test('reaches the page uncaught when the subscriber of the returned actor has only a next callback', async () => {
    const faulty = connect(startFaulty());
    const calls: string[] = [];
    faulty.subscribe(() => calls.push('next'));

    const errors = await uncaught(() => faulty.send({ type: 'BOOM' }));
    expect({ uncaught: messages(errors), calls }).toEqual({ uncaught: ['boom'], calls: [] });
  });

  test('goes to the error callback of a subscriber of the returned actor, and not to complete or the page', async () => {
    const faulty = connect(startFaulty());
    const calls: string[] = [];
    faulty.subscribe({
      error: (error) => calls.push(`error ${errorMessage(error)}`),
      complete: () => calls.push('complete'),
    });

    const errors = await uncaught(() => faulty.send({ type: 'BOOM' }));
    expect({ uncaught: messages(errors), calls }).toEqual({ uncaught: [], calls: ['error boom'] });
  });
});

describe('an actor that finishes during a preview', () => {
  test.each(OWNERS)(
    'an observer of %s gets the done snapshot, then complete, and waitFor resolves with it, once %s',
    async (_, _end, run) => {
      const machine = createJobMachine();
      const { job, finishReal, end } = await run(machine);
      const calls = observe(job);
      // It unsubscribes in next on the done snapshot, so it gets no complete, as with XState.
      const untilDone = observeUntilDone(job);
      const finished = waitForFinished(job);
      await preview(machine.id, ['waiting']);

      finishReal();
      const previewing = { calls: [...calls], untilDone: [...untilDone], waitFor: finished() };
      await end();
      expect({ previewing, ended: { calls, untilDone, waitFor: finished() } }).toEqual({
        previewing: { calls: ['next active waiting'], untilDone: ['next active'], waitFor: 'pending' },
        ended: {
          calls: ['next active waiting', 'next done finished', 'complete'],
          untilDone: ['next active', 'next done'],
          waitFor: 'resolved done 42',
        },
      });
    },
  );
});

test('toPromise stays pending while a final state is previewed, and resolves with the real output once the actor finishes', async () => {
  const machine = createJobMachine();
  const actor = start(machine);
  const job = connect(actor);
  const done = outcome(toPromise(job));
  await mount(null, { fixtures: [defineFixtures(machine, { cancelled: { context: { result: -1 } } })] });
  await preview(machine.id, ['cancelled']);

  await tick();
  const previewing = { shown: read(job), done: done() };
  actor.send({ type: 'FINISH' });
  await flush();
  expect({ previewing, done: done() }).toEqual({
    previewing: { shown: { status: 'done', value: 'cancelled', output: -1 }, done: 'pending' },
    done: 'resolved 42',
  });
});
