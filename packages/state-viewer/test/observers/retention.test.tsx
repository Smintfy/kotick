import { act, render, screen } from '@testing-library/react';
import * as React from 'react';
import { StateViewer } from 'state-viewer';
import { connect } from 'state-viewer/xstate';
import { describe, expect, test } from 'vitest';
import { createActor, createMachine, waitFor, type AnyActorRef, type Observer, type SnapshotFrom } from 'xstate';
import { collected } from '../support/gc';
import { ACTOR_SELECT, describeWithActivity, IMPLEMENTATIONS, type Hooks } from '../support/hooks';
import { flush, freshId, preview } from '../support/panel';

function createJobMachine() {
  return createMachine({
    id: freshId('job'),
    initial: 'running',
    states: { running: { on: { FINISH: 'finished' } }, finished: { type: 'final' } },
  });
}

type JobSnapshot = SnapshotFrom<ReturnType<typeof createJobMachine>>;
type JobSubscriber = Observer<JobSnapshot> | ((snapshot: JobSnapshot) => void);

const listener =
  (heard: string[]) =>
  (snapshot: JobSnapshot): void => {
    heard.push(`next ${snapshot.status}`);
  };
const withError = (heard: string[]): Observer<JobSnapshot> => ({
  next: listener(heard),
  error: () => heard.push('error'),
});
const withComplete = (heard: string[]): Observer<JobSnapshot> => ({
  next: listener(heard),
  complete: () => heard.push('complete'),
});

/**
 * Runs a connected job to its final state, and lets go of it.
 * The subscriber subscribes before the job finishes or after it, and never unsubscribes.
 */
function finishJob(subscriber: JobSubscriber, subscribe: 'before' | 'after'): WeakRef<object> {
  const actor = createActor(createJobMachine()).start();
  const job = connect(actor);
  if (subscribe === 'before') job.subscribe(subscriber as Observer<JobSnapshot>);
  job.send({ type: 'FINISH' });
  if (subscribe === 'after') job.subscribe(subscriber as Observer<JobSnapshot>);
  return new WeakRef(actor);
}

test('a finished actor that a subscriber never unsubscribed from can be garbage-collected', async () => {
  const heard: string[] = [];
  const job = finishJob(listener(heard), 'before');

  expect({ heard, collected: await collected([job]) }).toEqual({ heard: ['next done'], collected: [true] });
});

describe('a finished job with a subscriber that never unsubscribes', () => {
  test.each([
    ['an observer with next and error, as useSelector subscribes', withError, ['next done']],
    ['an observer with next and complete', withComplete, ['next done', 'complete']],
  ])('subscribed with %s: a connect()ed actor can be garbage-collected once it is done', async (_, make, expected) => {
    const heard: string[] = [];
    const job = finishJob(make(heard), 'before');

    expect({ heard, collected: await collected([job]) }).toEqual({ heard: expected, collected: [true] });
  });

  test.each([
    ['a listener function', listener, []],
    ['an observer with next and error, as useSelector subscribes', withError, []],
    ['an observer with next and complete', withComplete, ['complete']],
  ])('subscribed with %s: a connect()ed actor subscribed after it finished can be garbage-collected', async (_, make, expected) => {
    const heard: string[] = [];
    const job = finishJob(make(heard), 'after');

    expect({ heard, collected: await collected([job]) }).toEqual({ heard: expected, collected: [true] });
  });
});

describe('a connect()ed job that finishes while a preview shows', () => {
  /** Previews a connected job in the state it is in, finishes the real job meanwhile, and lets go of it. */
  async function finishDuringPreview(heard: string[]): Promise<WeakRef<object>> {
    const machine = createJobMachine();
    const actor = createActor(machine).start();
    connect(actor).subscribe((snapshot) => heard.push(`${snapshot.status} ${String(snapshot.value)}`));
    await flush();
    await preview(machine.id, ['running']);
    // The proxy blocks events during a preview, so the event goes to the real actor.
    await act(async () => {
      actor.send({ type: 'FINISH' });
    });
    return new WeakRef(actor);
  }

  test('gets the held-back done snapshot when the preview is released, then can be garbage-collected', async () => {
    const overlay = render(<StateViewer defaultOpen />);
    await flush();
    const heard: string[] = [];
    const job = await finishDuringPreview(heard);
    // React keeps the registry snapshot of the overlay's previous render until the overlay renders again.
    // That snapshot lists the job, so the overlay unmounts before the check.
    overlay.unmount();

    expect({ heard, collected: await collected([job]) }).toEqual({
      heard: ['active running', 'done finished'],
      collected: [true],
    });
  });
});

function createFormMachine() {
  return createMachine({
    id: freshId('form'),
    initial: 'loading',
    invoke: {
      id: 'field',
      src: createMachine({
        id: freshId('field'),
        initial: 'pristine',
        states: { pristine: { on: { EDIT: 'dirty' } }, dirty: {} },
      }),
    },
    states: {
      loading: { on: { LOADED: 'ready' } },
      ready: { on: { SUBMIT: 'submitting' } },
      submitting: { on: { SAVED: 'saved' } },
      saved: { type: 'final' },
    },
  });
}

type FormMachine = ReturnType<typeof createFormMachine>;

/** Where the form puts its actor, as an app keeps it for a handler that runs later. */
type Hand = { actorRef?: AnyActorRef };

/** The hooks of state-viewer, for the steps that only its proxies have. */
const stateViewer = IMPLEMENTATIONS[1][1];

function Form({ hooks, machine, hand }: { hooks: Hooks; machine: FormMachine; hand: Hand }) {
  const actorRef = hooks.useActorRef(machine);
  hand.actorRef = actorRef;
  const value = hooks.useSelector(actorRef, (snapshot) => snapshot.value);
  return <output aria-label="form">{JSON.stringify(value)}</output>;
}

function actorOf(hand: Hand): AnyActorRef {
  if (!hand.actorRef) throw new Error('The form did not render.');
  return hand.actorRef;
}

/**
 * Takes the actor out of the hand, so only the caller holds it.
 * React still reaches the props of an unmounted form, and the hand with them.
 */
function take(hand: Hand): AnyActorRef {
  const actorRef = actorOf(hand);
  hand.actorRef = undefined;
  return actorRef;
}

function shown(): unknown {
  return JSON.parse(screen.getByRole('status', { name: 'form' }).textContent ?? 'null');
}

/** Subscribes to the form's actor, and records in `heard` the state values that the subscription is given. */
type Subscribe = (actorRef: AnyActorRef, heard: string[]) => void;

/**
 * Mounts a form, then unmounts it, as when the user navigates away.
 * The app subscribes to the form's actor while the form is mounted.
 * Or it subscribes after the form unmounted, as a handler that awaits does.
 * Returns a weak reference to the actor's system.
 */
async function navigateAway(
  hooks: Hooks,
  subscribe: Subscribe,
  when: 'while mounted' | 'after unmount',
): Promise<WeakRef<object>> {
  const hand: Hand = {};
  const { unmount } = render(<Form hooks={hooks} machine={createFormMachine()} hand={hand} />);
  await flush();
  const actorRef = take(hand);
  if (when === 'while mounted') subscribe(actorRef, []);
  unmount();
  await flush();
  if (when === 'after unmount') subscribe(actorRef, []);
  const system = new WeakRef(actorRef.system);
  await flush();
  return system;
}

const OPEN_SUBSCRIPTIONS: [name: string, subscribe: Subscribe][] = [
  ['without a pending waitFor', () => {}],
  [
    'with a pending waitFor',
    (actorRef) => {
      void waitFor(actorRef, (snapshot) => snapshot.status === 'done').catch(() => {});
    },
  ],
  [
    'with a subscription, never unsubscribed, that has complete',
    (actorRef) => {
      actorRef.subscribe({ next: () => {}, complete: () => {} });
    },
  ],
];

describe('a hook actor unmounted while a subscription to its proxy is open', () => {
  describe.each(IMPLEMENTATIONS)('with %s', (_, hooks) => {
    test.each(OPEN_SUBSCRIPTIONS)('can be garbage-collected %s', async (_name, subscribe) => {
      const system = await navigateAway(hooks, subscribe, 'while mounted');

      expect(await collected([system])).toEqual([true]);
    });
  });

  test('state-viewer/xstate: can be garbage-collected with a subscription, never unsubscribed, to a connect()ed child', async () => {
    const subscribe: Subscribe = (actorRef) => {
      connect(actorRef.getSnapshot().children.field as AnyActorRef).subscribe(() => {});
    };
    const system = await navigateAway(stateViewer, subscribe, 'while mounted');

    expect(await collected([system])).toEqual([true]);
  });
});

describe('under StrictMode, an effect without cleanup that follows the hook actor', () => {
  /** Mounts a form whose effect follows its actor, and records what each run of the effect hears. */
  async function mount(hooks: Hooks, follow: 'waitFor' | 'subscribe', withOverlay: boolean) {
    const machine = createFormMachine();
    const heard: string[] = [];
    const hand: Hand = {};
    let runs = 0;
    function FollowingForm() {
      const actorRef = hooks.useActorRef(machine);
      hand.actorRef = actorRef;
      React.useEffect(() => {
        runs += 1;
        const run = runs;
        const hear = (snapshot: { value: unknown }) => heard.push(`${run}:${String(snapshot.value)}`);
        if (follow === 'waitFor') void waitFor(actorRef, (snapshot) => snapshot.matches('ready')).then(hear, () => {});
        else actorRef.subscribe(hear);
      }, [actorRef]);
      return null;
    }
    render(
      <>
        <FollowingForm />
        {withOverlay && <StateViewer defaultOpen />}
      </>,
    );
    await flush();
    return { machine, heard, hand };
  }

  describe.each(IMPLEMENTATIONS)('with %s', (_, hooks) => {
    test.each(['waitFor', 'subscribe'] as const)('%s: a real transition reaches the second run only', async (follow) => {
      const { heard, hand } = await mount(hooks, follow, false);

      act(() => actorOf(hand).send({ type: 'LOADED' }));
      await flush();
      expect(heard).toEqual(['2:ready']);
    });
  });

  test.each(['waitFor', 'subscribe'] as const)('state-viewer/xstate, %s: a preview reaches the second run only', async (follow) => {
    const { machine, heard } = await mount(stateViewer, follow, true);

    await preview(machine.id, ['ready']);
    expect(heard).toEqual(['2:ready']);
  });
});

const Activity = (
  React as unknown as { Activity: React.ComponentType<{ mode: 'visible' | 'hidden'; children: React.ReactNode }> }
).Activity;

describeWithActivity('an Activity hiding and revealing the component', () => {
  /** Subscribes to the form's actor outside React, then hides the form and reveals it. */
  async function hideAndReveal(hooks: Hooks, withOverlay: boolean) {
    const machine = createFormMachine();
    const hand: Hand = {};
    const heard: string[] = [];
    const app = (mode: 'visible' | 'hidden') => (
      <>
        <Activity mode={mode}>
          <Form hooks={hooks} machine={machine} hand={hand} />
        </Activity>
        {withOverlay && <StateViewer defaultOpen />}
      </>
    );
    const view = render(app('visible'));
    await flush();
    actorOf(hand).subscribe((snapshot: { value: unknown }) => heard.push(String(snapshot.value)));
    view.rerender(app('hidden'));
    await flush();
    view.rerender(app('visible'));
    await flush();
    return { machine, heard, hand };
  }

  test.each(IMPLEMENTATIONS)('%s: ends a subscription made before hiding', async (_, hooks) => {
    const { heard, hand } = await hideAndReveal(hooks, false);

    act(() => actorOf(hand).send({ type: 'LOADED' }));
    await flush();
    expect({ heard, shown: shown() }).toEqual({ heard: [], shown: 'ready' });
  });

  test('state-viewer/xstate: the ended subscription hears no preview either', async () => {
    const { machine, heard } = await hideAndReveal(stateViewer, true);

    await preview(machine.id, ['ready']);
    expect({ heard, shown: shown() }).toEqual({ heard: [], shown: 'ready' });
  });
});

const LATE_SUBSCRIPTIONS: [name: string, subscribe: Subscribe][] = [
  [
    'waitFor',
    (actorRef, heard) => {
      void waitFor(actorRef, (snapshot) => {
        heard.push(String(snapshot.value));
        return snapshot.status === 'done';
      }).catch(() => {});
    },
  ],
  [
    'subscribe(listener)',
    (actorRef, heard) => {
      actorRef.subscribe((snapshot: { value: unknown }) => heard.push(String(snapshot.value)));
    },
  ],
  [
    'select().subscribe',
    (actorRef, heard) => {
      actorRef.select((snapshot: { value: unknown }) => String(snapshot.value)).subscribe((value) => heard.push(value));
    },
  ],
];

/**
 * The late subscriptions to try with an implementation.
 * XState's own actors have select() from XState 5.29.
 * The rows that preview run the proxies of state-viewer, which have select() with every XState.
 */
function lateSubscriptions(previews: boolean): [name: string, subscribe: Subscribe][] {
  if (previews || ACTOR_SELECT) return LATE_SUBSCRIPTIONS;
  return LATE_SUBSCRIPTIONS.filter(([name]) => !name.startsWith('select'));
}

describe('a subscription made through a hook proxy after the component unmounted', () => {
  describe.each(IMPLEMENTATIONS)('with %s', (_, hooks, previews) => {
    test.each(lateSubscriptions(previews))('%s: the actor can be garbage-collected with it pending', async (_name, subscribe) => {
      const system = await navigateAway(hooks, subscribe, 'after unmount');

      expect(await collected([system])).toEqual([true]);
    });
  });
});

describeWithActivity('a subscription made while an <Activity> hides the component, which is then removed', () => {
  /** Hides the form, subscribes to its actor meanwhile, then removes the hidden form. */
  async function subscribeWhileHiddenThenRemove(hooks: Hooks, subscribe: Subscribe): Promise<WeakRef<object>> {
    const machine = createFormMachine();
    const hand: Hand = {};
    const app = (mode: 'visible' | 'hidden', present: boolean) =>
      present ? (
        <Activity mode={mode}>
          <Form hooks={hooks} machine={machine} hand={hand} />
        </Activity>
      ) : null;
    const view = render(app('visible', true));
    await flush();
    view.rerender(app('hidden', true));
    await flush();
    const actorRef = take(hand);
    subscribe(actorRef, []);
    const system = new WeakRef(actorRef.system);
    view.rerender(app('hidden', false));
    await flush();
    view.unmount();
    await flush();
    return system;
  }

  describe.each(IMPLEMENTATIONS)('with %s', (_, hooks, previews) => {
    test.each(lateSubscriptions(previews))('%s: the actor can be garbage-collected with it pending', async (_name, subscribe) => {
      const system = await subscribeWhileHiddenThenRemove(hooks, subscribe);

      expect(await collected([system])).toEqual([true]);
    });
  });
});

describeWithActivity('a subscription made while an <Activity> hides the component, which is then revealed', () => {
  /**
   * Hides the form, subscribes to its actor meanwhile, then reveals the form.
   * Returns what the subscription hears from then on.
   */
  async function subscribeWhileHiddenThenReveal(
    hooks: Hooks,
    subscribe: Subscribe,
    reactStrictMode: boolean,
    withOverlay: boolean,
  ) {
    const machine = createFormMachine();
    const hand: Hand = {};
    const heard: string[] = [];
    const app = (mode: 'visible' | 'hidden') => (
      <>
        <Activity mode={mode}>
          <Form hooks={hooks} machine={machine} hand={hand} />
        </Activity>
        {withOverlay && <StateViewer defaultOpen />}
      </>
    );
    const view = render(app('visible'), { reactStrictMode });
    await flush();
    view.rerender(app('hidden'));
    await flush();
    subscribe(actorOf(hand), heard);
    view.rerender(app('visible'));
    await flush();
    // The test asserts what the subscription hears after the reveal.
    heard.length = 0;
    return { machine, heard, hand };
  }

  // The simulated unmount of StrictMode stops the actor when the Activity reveals it, which ends the subscription.
  const STRICT: [reactStrictMode: boolean, expected: string[]][] = [
    [false, ['ready']],
    [true, []],
  ];

  describe.each(IMPLEMENTATIONS)('with %s', (_, hooks, previews) => {
    describe.each(lateSubscriptions(previews))('%s', (_kind, subscribe) => {
      test.each(STRICT)('StrictMode %s: a real transition after the reveal', async (strict, expected) => {
        const { heard, hand } = await subscribeWhileHiddenThenReveal(hooks, subscribe, strict, false);

        act(() => actorOf(hand).send({ type: 'LOADED' }));
        await flush();
        expect({ heard, shown: shown() }).toEqual({ heard: expected, shown: 'ready' });
      });
    });
  });

  describe.each(LATE_SUBSCRIPTIONS)('state-viewer/xstate, %s', (_kind, subscribe) => {
    test.each(STRICT)('StrictMode %s: a preview after the reveal', async (strict, expected) => {
      const { machine, heard } = await subscribeWhileHiddenThenReveal(stateViewer, subscribe, strict, true);

      await preview(machine.id, ['ready']);
      expect({ heard, shown: shown() }).toEqual({ heard: expected, shown: 'ready' });
    });
  });
});
