import { act, render, screen } from '@testing-library/react';
import * as React from 'react';
import { Kotick } from 'kotick';
import { connect, useActorRef, useSelector } from 'kotick/xstate';
import { expect, test } from 'vitest';
import { createActor, createMachine, waitFor, type AnyActorRef, type Observer, type SnapshotFrom } from 'xstate';
import { collected } from '../support/gc';
import { describeWithActivity } from '../support/react';
import type { Json } from '../support/json';
import { flush, freshId, preview } from '../support/panel';

function createJobMachine() {
  return createMachine({
    id: freshId('job'),
    initial: 'running',
    states: { running: { on: { FINISH: 'finished' } }, finished: { type: 'final' } },
  });
}

type JobSnapshot = SnapshotFrom<ReturnType<typeof createJobMachine>>;

const listener =
  (heard: string[]) =>
  (snapshot: JobSnapshot): void => {
    heard.push(`next ${snapshot.status}`);
  };

function finishJob(subscriber: Observer<JobSnapshot>, subscribe: 'before' | 'after'): WeakRef<object> {
  const actor = createActor(createJobMachine()).start();
  const job = connect(actor);

  if (subscribe === 'before') job.subscribe(subscriber);
  job.send({ type: 'FINISH' });

  if (subscribe === 'after') job.subscribe(subscriber);

  return new WeakRef(actor);
}

test('a finished actor that a subscriber never unsubscribed from can be garbage-collected', async () => {
  const heard: string[] = [];
  const job = finishJob({ next: listener(heard) }, 'before');

  expect({ heard, collected: await collected([job]) }).toEqual({ heard: ['next done'], collected: [true] });
});

test.each([
  ['an observer with next and error, as useSelector subscribes', (heard: string[]) => ({ error: () => heard.push('error') }), []],
  ['an observer with next and complete', (heard: string[]) => ({ complete: () => heard.push('complete') }), ['complete']],
])(
  'a connect()ed actor that %s subscribed to after it finished can be garbage-collected',
  async (_, ending: (heard: string[]) => Observer<JobSnapshot>, expected) => {
    const heard: string[] = [];
    const job = finishJob({ next: listener(heard), ...ending(heard) }, 'after');

    expect({ heard, collected: await collected([job]) }).toEqual({ heard: expected, collected: [true] });
  },
);

test('a connect()ed job that finishes while a preview shows gets the held-back done snapshot when the overlay drops it, then can be garbage-collected', async () => {
  const overlay = render(<Kotick defaultOpen />);
  await flush();
  const heard: string[] = [];

  const finishDuringPreview = async (): Promise<WeakRef<object>> => {
    const machine = createJobMachine();
    const real = createActor(machine).start();
    connect(real).subscribe((snapshot) => heard.push(`${snapshot.status} ${String(snapshot.value)}`));
    await flush();
    await preview(machine.id, ['running']);
    await act(async () => {
      real.send({ type: 'FINISH' });
    });

    return new WeakRef(real);
  };

  const job = await finishDuringPreview();
  // React keeps the registry snapshot of the overlay's previous render until the overlay renders again.
  // That snapshot lists the job, so the overlay unmounts before the check.
  overlay.unmount();

  expect({ heard, collected: await collected([job]) }).toEqual({
    heard: ['active running', 'done finished'],
    collected: [true],
  });
});

function createFormMachine() {
  return createMachine({
    id: freshId('form'),
    initial: 'loading',
    states: {
      loading: { on: { LOADED: 'ready' } },
      ready: { on: { SUBMIT: 'submitting' } },
      submitting: { on: { SAVED: 'saved' } },
      saved: { type: 'final' },
    },
  });
}

type FormMachine = ReturnType<typeof createFormMachine>;

type Hand = { actorRef?: AnyActorRef };

function Form({ machine, hand }: { machine: FormMachine; hand: Hand }) {
  const actorRef = useActorRef(machine);
  hand.actorRef = actorRef;
  const value = useSelector(actorRef, (snapshot) => snapshot.value);

  return <output aria-label="form">{JSON.stringify(value)}</output>;
}

function actorOf(hand: Hand): AnyActorRef {
  if (!hand.actorRef) throw new Error('The form did not render.');

  return hand.actorRef;
}

function shown(): Json {
  return JSON.parse(screen.getByRole('status', { name: 'form' }).textContent ?? 'null');
}

function awaitSaved(actorRef: AnyActorRef): void {
  void waitFor(actorRef, (snapshot) => snapshot.status === 'done').catch(() => {});
}

async function navigateAway(when: 'while mounted' | 'after unmount'): Promise<WeakRef<object>> {
  const hand: Hand = {};
  const { unmount } = render(<Form machine={createFormMachine()} hand={hand} />);
  await flush();
  // Takes the actor out of the hand, so only this function holds it.
  // React still reaches the props of an unmounted form, and the hand with them.
  const actorRef = actorOf(hand);
  hand.actorRef = undefined;

  if (when === 'while mounted') awaitSaved(actorRef);
  unmount();
  await flush();

  if (when === 'after unmount') awaitSaved(actorRef);
  const system = new WeakRef(actorRef.system);
  await flush();

  return system;
}

test.each(['while mounted', 'after unmount'] as const)(
  'a hook actor can be garbage-collected after the component unmounted, with a waitFor started %s still pending',
  async (when) => {
    expect(await collected([await navigateAway(when)])).toEqual([true]);
  },
);

test('under StrictMode, a preview reaches only the second run of an effect without cleanup that subscribes to the hook actor', async () => {
  const machine = createFormMachine();
  const heard: string[] = [];
  let runs = 0;

  function FollowingForm() {
    const actorRef = useActorRef(machine);
    React.useEffect(() => {
      runs += 1;
      const run = runs;
      actorRef.subscribe((snapshot: { value: unknown }) => heard.push(`${run}:${String(snapshot.value)}`));
    }, [actorRef]);

    return null;
  }

  render(
    <>
      <FollowingForm />
      <Kotick defaultOpen />
    </>,
  );
  await flush();

  await preview(machine.id, ['ready']);
  expect(heard).toEqual(['2:ready']);
});

describeWithActivity('an Activity hiding and revealing the component', () => {
  test('ends a subscription made before hiding, which hears no preview either', async () => {
    const machine = createFormMachine();
    const hand: Hand = {};
    const heard: string[] = [];

    const app = (mode: 'visible' | 'hidden') => (
      <>
        <React.Activity mode={mode}>
          <Form machine={machine} hand={hand} />
        </React.Activity>
        <Kotick defaultOpen />
      </>
    );

    const view = render(app('visible'));
    await flush();
    actorOf(hand).subscribe((snapshot: { value: unknown }) => heard.push(String(snapshot.value)));
    view.rerender(app('hidden'));
    await flush();
    view.rerender(app('visible'));
    await flush();

    await preview(machine.id, ['ready']);
    expect({ heard, shown: shown() }).toEqual({ heard: [], shown: 'ready' });
  });
});
