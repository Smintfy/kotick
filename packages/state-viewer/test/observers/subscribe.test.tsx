import { act } from '@testing-library/react';
import type { StateViewerProps } from 'state-viewer';
import { connect, defineFixtures, useActorRef } from 'state-viewer/xstate';
import { describe, expect, test } from 'vitest';
import {
  Actor,
  assign,
  createActor,
  createMachine,
  fromPromise,
  setup,
  toPromise,
  waitFor,
  type AnyActorRef,
  type AnyStateMachine,
  type EventFrom,
  type SnapshotFrom,
} from 'xstate';
import { mount, start } from '../support/app';
import { uncaught } from '../support/console';
import { collected } from '../support/gc';
import { IMPLEMENTATIONS } from '../support/hooks';
import { badge, clickLeaf, flush, freshId, machines, panel, preview, release } from '../support/panel';

function createCheckoutMachine() {
  return setup({
    types: {
      context: {} as { items: number },
      events: {} as { type: 'ADD' } | { type: 'PAY' } | { type: 'SUCCEED' } | { type: 'NOOP' },
    },
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

/** Finishes with output 42 on FINISH. `waiting` and `cancelled` are there to be previewed. */
function createJobMachine() {
  return setup({
    types: { context: {} as { result: number }, events: {} as { type: 'FINISH' } },
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

/**
 * Finishes when the request that it invokes settles, with the response as output.
 * respond() settles the request, as a server does.
 * `waiting` and `cancelled` are there to be previewed.
 */
function createFetchMachine() {
  let settle: (response: number) => void = () => {};

  const machine = setup({
    types: { context: {} as { result: number } },
    actors: {
      request: fromPromise(
        () =>
          new Promise<number>((resolve) => {
            settle = resolve;
          }),
      ),
    },
  }).createMachine({
    id: freshId('fetch'),
    context: { result: 0 },
    initial: 'running',
    states: {
      running: {
        invoke: { src: 'request', onDone: { target: 'finished', actions: assign({ result: ({ event }) => event.output }) } },
      },
      waiting: {},
      finished: { type: 'final' },
      cancelled: { type: 'final' },
    },
    output: ({ context }) => context.result,
  });

  return { machine, respond: (response: number) => settle(response) };
}

/** Runs the machine in a component, and returns the actor that the hook gives back, as an app that hands it on does. */
async function mountHook(
  machine: AnyStateMachine,
  use: (machine: AnyStateMachine) => AnyActorRef,
  props?: StateViewerProps,
): Promise<AnyActorRef> {
  const held: { actor?: AnyActorRef } = {};

  function Job() {
    held.actor = use(machine);

    return null;
  }

  await mount(<Job />, props);

  if (!held.actor) throw new Error('The job did not render.');

  return held.actor;
}

async function send(actor: Checkout, ...events: EventFrom<CheckoutMachine>[]) {
  await act(async () => {
    for (const event of events) actor.send(event);
  });
}

/** Waits one real tick, so the promises that a request settles have run. */
async function tick(): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

/** A snapshot as a subscriber of the checkout records it: its value, then its item count. */
function summary(snapshot: SnapshotFrom<CheckoutMachine>): string {
  return `${JSON.stringify(snapshot.value)} ${snapshot.context.items}`;
}

/** What an app reads from the actor: its status, its state value, and its output when it is done. */
function read(actor: AnyActorRef) {
  const { status, value, output } = actor.getSnapshot();

  return { status, value, output };
}

/**
 * Records how a promise settles, as a string, so that a rejection shows in the assertion.
 * The record is 'pending' until then.
 */
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

/** Waits for the final state of a job, and records the status and output of the snapshot that the wait resolves with. */
function waitForFinished(job: AnyActorRef): () => string {
  const finished = waitFor(job, (snapshot) => snapshot.matches('finished'));

  return outcome(finished.then((snapshot) => `${snapshot.status} ${snapshot.output}`));
}

/** Subscribes an observer with next and complete, and returns its calls: the status and state value, or complete. */
function observe(job: AnyActorRef): string[] {
  const calls: string[] = [];
  job.subscribe({
    next: (snapshot) => calls.push(`next ${snapshot.status} ${String(snapshot.value)}`),
    complete: () => calls.push('complete'),
  });

  return calls;
}

/** A job that the app runs, with how the app finishes the real actor, and how the preview of the job then ends. */
type Run = { job: AnyActorRef; finish: () => void; end: () => Promise<void> };

/**
 * The actors that an app subscribes to: the actor that connect() returns, and the actor that a hook returns.
 * A preview blocks the events sent to them, so the app finishes the real actor.
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

      return { job, finish: () => actor.send({ type: 'FINISH' }), end: flush };
    },
  ],
  [
    'a hook actor',
    'the preview is released',
    async (machine) => {
      const job = await mountHook(machine, (logic) => useActorRef(logic, { systemId: 'job' }));

      return {
        job,
        finish: () => job.system.get('job')?.send({ type: 'FINISH' }),
        end: () => release(machine.id),
      };
    },
  ],
];

describe('subscribing to the actor that connect() returns', () => {
  test('without a preview, a subscriber gets each snapshot that the actor sends, repeats included', async () => {
    const machine = createCheckoutMachine();
    const actor = start(machine);
    const checkout = connect(actor);
    const real: SnapshotFrom<CheckoutMachine>[] = [];
    const proxied: SnapshotFrom<CheckoutMachine>[] = [];
    actor.subscribe((snapshot) => real.push(snapshot));
    checkout.subscribe((snapshot) => proxied.push(snapshot));

    // NOOP changes nothing, and XState sends the same snapshot again.
    await send(checkout, { type: 'ADD' }, { type: 'NOOP' }, { type: 'PAY' });
    const same = proxied.map((snapshot, index) => snapshot === real[index]);
    expect({ proxied: proxied.map(summary), same }).toEqual({
      proxied: ['"cart" 1', '"cart" 1', '{"payment":"pending"} 1'],
      same: [true, true, true],
    });
  });

  test('subscribe() takes an observer object, called with itself as this, or next, error and complete callbacks', async () => {
    const machine = createCheckoutMachine();
    const checkout = connect(start(machine));
    const calls: string[] = [];

    const observer = {
      name: 'observer',
      next(snapshot: SnapshotFrom<CheckoutMachine>) {
        calls.push(`${this.name} next ${summary(snapshot)}`);
      },
      complete() {
        calls.push(`${this.name} complete`);
      },
    };

    checkout.subscribe(observer);
    checkout.subscribe(
      (snapshot) => calls.push(`callbacks next ${summary(snapshot)}`),
      () => calls.push('callbacks error'),
      () => calls.push('callbacks complete'),
    );

    await send(checkout, { type: 'ADD' }, { type: 'PAY' }, { type: 'SUCCEED' });
    expect(calls).toEqual([
      'observer next "cart" 1',
      'callbacks next "cart" 1',
      'observer next {"payment":"pending"} 1',
      'callbacks next {"payment":"pending"} 1',
      'observer next "paid" 1',
      'callbacks next "paid" 1',
      'observer complete',
      'callbacks complete',
    ]);
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

  const messages = (errors: unknown[]) => errors.map((error) => (error as Error).message);

  // XState reports an error as uncaught unless each observer of the actor has an error callback.
  // connect() adds no observer, so the observers of the app decide, as without connect().
  test.each<[string, (actor: AnyActorRef, calls: string[]) => void]>([
    ['no subscriber', () => {}],
    ['a next callback', (actor, calls) => actor.subscribe(() => calls.push('next'))],
    [
      'an observer object without error',
      (actor, calls) => actor.subscribe({ next: () => calls.push('next'), complete: () => calls.push('complete') }),
    ],
  ])('reaches the page uncaught when the returned actor has %s', async (_, observe) => {
    const faulty = connect(startFaulty());
    const calls: string[] = [];
    observe(faulty, calls);

    const errors = await uncaught(() => faulty.send({ type: 'BOOM' }));
    expect({ uncaught: messages(errors), calls }).toEqual({ uncaught: ['boom'], calls: [] });
  });

  test('goes to the error callback of a subscriber of the returned actor, and not to complete or the page', async () => {
    const faulty = connect(startFaulty());
    const calls: string[] = [];
    faulty.subscribe({
      error: (error) => calls.push(`error ${(error as Error).message}`),
      complete: () => calls.push('complete'),
    });

    const errors = await uncaught(() => faulty.send({ type: 'BOOM' }));
    expect({ uncaught: messages(errors), calls }).toEqual({ uncaught: [], calls: ['error boom'] });
  });

  test('goes to the error callback of a subscriber of the actor itself, and not to the page, after connect()', async () => {
    const actor = startFaulty();
    connect(actor);
    const calls: string[] = [];
    actor.subscribe({ error: (error) => calls.push(`error ${(error as Error).message}`) });

    const errors = await uncaught(() => actor.send({ type: 'BOOM' }));
    expect({ uncaught: messages(errors), calls }).toEqual({ uncaught: [], calls: ['error boom'] });
  });
});

describe('an actor that finishes during a preview', () => {
  test.each(OWNERS)(
    'an observer of %s gets the done snapshot, then complete, and waitFor resolves with it, once %s',
    async (_, _end, run) => {
      const machine = createJobMachine();
      const { job, finish, end } = await run(machine);
      const calls = observe(job);
      const finished = waitForFinished(job);
      await preview(machine.id, ['waiting']);

      finish();
      const previewing = { calls: [...calls], waitFor: finished() };
      await end();
      expect({ previewing, ended: { calls, waitFor: finished() } }).toEqual({
        previewing: { calls: ['next active waiting'], waitFor: 'pending' },
        ended: {
          calls: ['next active waiting', 'next done finished', 'complete'],
          waitFor: 'resolved done 42',
        },
      });
    },
  );

  test('finished by its own invoke, an observer gets the done snapshot before complete, and waitFor resolves with it', async () => {
    const { machine, respond } = createFetchMachine();
    const job = connect(start(machine));
    const calls = observe(job);
    const finished = waitForFinished(job);
    await mount(null);
    await preview(machine.id, ['waiting']);

    respond(42);
    await tick();
    expect({ calls, waitFor: finished() }).toEqual({
      // The preview shows again when the live children that it carries over change.
      // The request stops when the job finishes.
      calls: ['next active waiting', 'next active waiting', 'next done finished', 'complete'],
      waitFor: 'resolved done 42',
    });
  });
});

describe('an observer that unsubscribes in next on the done snapshot', () => {
  /** Subscribes an observer that unsubscribes once it gets the done snapshot, and returns its calls. */
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

  test('without a preview, its complete is never called, as with XState', () => {
    const job = connect(start(createJobMachine()));
    const calls = observeUntilDone(job);

    job.send({ type: 'FINISH' });
    expect(calls).toEqual(['next done']);
  });

  test.each(OWNERS)('when %s finished during a preview, gets no complete once %s', async (_, _end, run) => {
    const machine = createJobMachine();
    const { job, finish, end } = await run(machine);
    const calls = observeUntilDone(job);
    await preview(machine.id, ['waiting']);

    finish();
    const previewing = [...calls];
    await end();
    expect({ previewing, ended: calls }).toEqual({ previewing: ['next active'], ended: ['next active', 'next done'] });
  });
});

describe('toPromise during a preview', () => {
  const fixtures = (machine: AnyStateMachine) => [defineFixtures(machine, { cancelled: { context: { result: -1 } } })];

  /** The leaves that the tests preview, and what the actor shows for each while it runs. */
  const PREVIEWED: [leaf: string, shown: ReturnType<typeof read>][] = [
    ['waiting', { status: 'active', value: 'waiting', output: undefined }],
    // A fixture gives the other final state another output.
    ['cancelled', { status: 'done', value: 'cancelled', output: -1 }],
  ];

  test.each(PREVIEWED)(
    'resolves with the real output of a connected actor that finishes while %s is previewed',
    async (leaf, shown) => {
      const machine = createJobMachine();
      const actor = start(machine);
      const job = connect(actor);
      const done = outcome(toPromise(job));
      await mount(null, { fixtures: fixtures(machine) });
      await preview(machine.id, [leaf]);

      const previewing = read(job);
      actor.send({ type: 'FINISH' });
      await flush();
      expect({ previewing, done: done() }).toEqual({ previewing: shown, done: 'resolved 42' });
    },
  );

  test.each(PREVIEWED)(
    'resolves with the real output of a hook actor that its own invoke finishes while %s is previewed',
    async (leaf, shown) => {
      const { machine, respond } = createFetchMachine();
      const job = await mountHook(machine, useActorRef, { fixtures: fixtures(machine) });
      const done = outcome(toPromise(job));
      await preview(machine.id, [leaf]);

      respond(42);
      await tick();
      // Hooks keep a finished actor listed, so the preview still shows.
      expect({ live: panel().live, previewing: read(job), done: done() }).toEqual({
        live: ['finished'],
        previewing: shown,
        done: 'resolved 42',
      });
    },
  );

  test.each(PREVIEWED)(
    'called on a hook actor that is already done while %s is previewed, resolves with its real output',
    async (leaf, shown) => {
      const machine = createJobMachine();
      const job = await mountHook(machine, useActorRef, { fixtures: fixtures(machine) });
      await act(async () => {
        job.send({ type: 'FINISH' });
      });
      await preview(machine.id, [leaf]);

      const done = outcome(toPromise(job));
      await tick();
      expect({ previewing: read(job), done: done() }).toEqual({ previewing: shown, done: 'resolved 42' });
    },
  );

  test('called on a connected actor that finished while previewed, before the overlay drops it, resolves with its real output', async () => {
    const machine = createJobMachine();
    const actor = start(machine);
    const job = connect(actor);
    await mount(null);
    await preview(machine.id, ['waiting']);

    actor.send({ type: 'FINISH' });
    const previewing = read(job);
    const done = outcome(toPromise(job));
    await tick();
    expect({ previewing, done: done() }).toEqual({
      previewing: { status: 'active', value: 'waiting', output: undefined },
      done: 'resolved 42',
    });
  });

  test('stays pending on a running actor while a final state is previewed', async () => {
    const machine = createJobMachine();
    const job = connect(start(machine));
    const done = outcome(toPromise(job));
    await mount(null);
    await preview(machine.id, ['cancelled']);

    await tick();
    expect({ previewing: read(job), done: done() }).toEqual({
      previewing: { status: 'done', value: 'cancelled', output: 0 },
      done: 'pending',
    });
  });
});

describe('waitFor called during a preview on an actor that already finished', () => {
  describe.each(IMPLEMENTATIONS)('like @xstate/react, with %s', (_, hooks, previews) => {
    test('on a hook actor, stays pending while the preview shows, and resolves with the done snapshot once released', async () => {
      const machine = createJobMachine();
      const job = await mountHook(machine, hooks.useActorRef);
      await act(async () => {
        job.send({ type: 'FINISH' });
      });

      if (previews) await preview(machine.id, ['waiting']);

      const finished = waitForFinished(job);
      await flush();
      const previewing = { shown: read(job), waitFor: finished() };

      if (previews) await release(machine.id);
      expect({ previewing, released: finished() }).toEqual({
        previewing: previews
          ? { shown: { status: 'active', value: 'waiting', output: undefined }, waitFor: 'pending' }
          : { shown: { status: 'done', value: 'finished', output: 42 }, waitFor: 'resolved done 42' },
        released: 'resolved done 42',
      });
    });
  });

  test('on a connected actor, called before the overlay drops the preview, resolves with the done snapshot once it does', async () => {
    const machine = createJobMachine();
    const actor = start(machine);
    const job = connect(actor);
    await mount(null);
    await preview(machine.id, ['waiting']);

    actor.send({ type: 'FINISH' });
    const previewing = read(job);
    const finished = waitForFinished(job);
    await flush();
    expect({ previewing, dropped: { previews: badge(), waitFor: finished() } }).toEqual({
      previewing: { status: 'active', value: 'waiting', output: undefined },
      dropped: { previews: '', waitFor: 'resolved done 42' },
    });
  });
});

describe('a subscriber that subscribes again as it hears the end of an actor that finished during a preview', () => {
  type Where = 'next' | 'complete';

  type Position = 'first' | 'middle' | 'last';

  type Resubscribe = (job: AnyActorRef) => void;

  const HOWS: [how: string, resubscribe: Resubscribe][] = [
    [
      'subscribe',
      (job) => {
        job.subscribe(() => {});
      },
    ],
    [
      'select().subscribe',
      (job) => {
        job.select((snapshot: { status: string }) => snapshot.status).subscribe(() => {});
      },
    ],
    [
      'waitFor',
      (job) => {
        // It is never satisfied, so it rejects when it hears that the job ended.
        void waitFor(job, (snapshot) => snapshot.matches('running')).catch(() => {});
      },
    ],
  ];

  const WHERES: Where[] = ['next', 'complete'];
  const POSITIONS: Position[] = ['first', 'middle', 'last'];

  /** Every combination of where the subscriber subscribes again, how, and its place among the three subscribers. */
  const CASES = WHERES.flatMap((where) =>
    HOWS.flatMap(([how, resubscribe]) =>
      POSITIONS.map((position) => [where, how, position, resubscribe] as [Where, string, Position, Resubscribe]),
    ),
  );

  /**
   * Subscribes a, b and c to the job in that order.
   * The one at `position` subscribes to the job again from inside `where` when it hears the job end.
   * Then waits for the final state, and records what the wait resolves with.
   */
  function subscribeAll(job: AnyActorRef, calls: string[], where: Where, position: Position, resubscribe: Resubscribe) {
    for (const [index, name] of ['a', 'b', 'c'].entries()) {
      const again = index === POSITIONS.indexOf(position);
      job.subscribe({
        next: (snapshot: { status: string }) => {
          calls.push(`${name} ${snapshot.status}`);

          if (again && where === 'next' && snapshot.status === 'done') resubscribe(job);
        },
        complete: () => {
          calls.push(`${name} complete`);

          if (again && where === 'complete') resubscribe(job);
        },
      });
    }

    return waitForFinished(job);
  }

  describe.each(OWNERS)('of %s, once %s', (_, _end, run) => {
    test.each(CASES)(
      'from inside %s (%s), subscriber %s: every subscriber hears the done snapshot and complete',
      async (where, _how, position, resubscribe) => {
        const machine = createJobMachine();
        const { job, finish, end } = await run(machine);
        const calls: string[] = [];
        const finished = subscribeAll(job, calls, where, position, resubscribe);
        await preview(machine.id, ['waiting']);

        finish();
        const previewing = [...calls];
        await end();
        expect({ previewing, ended: { calls, waitFor: finished() } }).toEqual({
          previewing: ['a active', 'b active', 'c active'],
          // Each subscriber in turn hears the done snapshot that the preview held back, then complete.
          ended: {
            calls: [
              'a active',
              'b active',
              'c active',
              'a done',
              'a complete',
              'b done',
              'b complete',
              'c done',
              'c complete',
            ],
            waitFor: 'resolved done 42',
          },
        });
      },
    );
  });

  test.each(WHERES.flatMap((where) => HOWS.map(([how, resubscribe]) => [where, how, resubscribe] as const)))(
    'the finished actor can be garbage-collected after a subscriber subscribed again from inside %s (%s)',
    async (where, _how, resubscribe) => {
      const machine = createJobMachine();
      const view = await mount(null);
      const heard: (() => string)[] = [];

      // A function of its own, so that no frame of the test holds the actor.
      // Nothing ends the subscriptions.
      const finishDuringPreview = async (): Promise<WeakRef<AnyActorRef>> => {
        const actor = createActor(machine).start();
        heard.push(subscribeAll(connect(actor), [], where, 'first', resubscribe));
        await flush();
        await preview(machine.id, ['waiting']);
        await act(async () => {
          actor.send({ type: 'FINISH' });
        });

        return new WeakRef(actor);
      };

      const refs = [await finishDuringPreview(), await finishDuringPreview(), await finishDuringPreview()];

      const listed = await machines();
      const previewing = badge();
      // React keeps the previous render of the overlay, which shows the last actor, until the overlay renders again.
      // Unmount the overlay. The page-wide registry stays.
      view.unmount();
      const gone = await collected(refs);
      expect({ machines: listed, previewing, gone, heard: heard.map((settled) => settled()) }).toEqual({
        machines: [],
        previewing: '',
        gone: [true, true, true],
        heard: ['resolved done 42', 'resolved done 42', 'resolved done 42'],
      });
    },
  );
});
