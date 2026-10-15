import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { connect, useMachine, useSelector } from 'state-viewer/xstate';
import { describe, expect, onTestFinished, test } from 'vitest';
import {
  Actor,
  assign,
  createActor,
  createMachine,
  fromCallback,
  fromPromise,
  sendTo,
  setup,
  type AnyActorRef,
  type AnyStateMachine,
  type EventFrom,
  type SnapshotFrom,
} from 'xstate';
import { page } from './support/app';
import { uncaught, watchConsole } from './support/console';
import { clickLeaf, flush, freshId, header, instanceKeys, panel, preview, release, shownKey } from './support/panel';

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

function createToggleMachine() {
  return createMachine({
    id: freshId('toggle'),
    initial: 'off',
    states: { off: { on: { TOGGLE: 'on' } }, on: { on: { TOGGLE: 'off' } } },
  });
}

/** Starts an actor outside React, as a module that owns it does. The actor stops when the test ends. */
function start<TMachine extends AnyStateMachine>(machine: TMachine): Actor<TMachine> {
  const actor = createActor(machine).start();
  onTestFinished(() => {
    actor.stop();
  });
  return actor;
}

/** Shows what a component reads from the actor that connect() returns. */
function CheckoutView({ actor }: { actor: Checkout }) {
  const snapshot = useSelector(actor, (current) => current);
  return <output aria-label="checkout">{JSON.stringify({ value: snapshot.value, items: snapshot.context.items })}</output>;
}

async function mount(app: ReactNode) {
  const view = render(page(app));
  await flush();
  return view;
}

function shown(name = 'checkout') {
  return JSON.parse(screen.getByRole('status', { name }).textContent ?? 'null');
}

async function send(actor: Checkout, ...events: EventFrom<CheckoutMachine>[]) {
  await act(async () => {
    for (const event of events) actor.send(event);
  });
}

/** A snapshot as a subscriber of the checkout records it: its value, then its item count. */
function summary(snapshot: SnapshotFrom<CheckoutMachine>): string {
  return `${JSON.stringify(snapshot.value)} ${snapshot.context.items}`;
}

test('an actor started outside React and connected is listed, and its preview shows in the component', async () => {
  const machine = createCheckoutMachine();
  const checkout = connect(start(machine));
  await mount(<CheckoutView actor={checkout} />);

  await send(checkout, { type: 'ADD' });
  const { machine: machines, instance } = header();
  const listed = { machines: machines?.options, instances: instance?.options, live: panel().live, shown: shown() };
  await preview(machine.id, ['payment.error']);
  const previewing = shown();
  await release(machine.id);
  expect({ listed, previewing, released: shown() }).toEqual({
    listed: {
      machines: [machine.id],
      instances: [`${machine.id} · 1`],
      live: ['cart'],
      shown: { value: 'cart', items: 1 },
    },
    previewing: { value: { payment: 'error' }, items: 1 },
    released: { value: 'cart', items: 1 },
  });
});

describe('options', () => {
  test('id and label name the actor in the overlay', async () => {
    const machine = createCheckoutMachine();
    const id = freshId('header-cart');
    const checkout = connect(start(machine), { id, label: 'Header cart' });
    await mount(<CheckoutView actor={checkout} />);

    await preview(id, ['payment.error']);
    const { machine: machines, instance } = header();
    expect({ machines: machines?.options, instances: instance?.options, shown: shown() }).toEqual({
      machines: [`${id} ●`],
      instances: ['Header cart · 1 ●'],
      shown: { value: { payment: 'error' }, items: 0 },
    });
  });
});

describe('several actors of one machine', () => {
  test('each connected actor is an instance of its own', async () => {
    const machine = createCheckoutMachine();
    connect(start(machine));
    connect(start(machine));
    await mount(null);

    await preview(machine.id, ['payment.error'], { nth: 2 });
    expect({ instances: header().instance?.options, keys: new Set(instanceKeys()).size }).toEqual({
      instances: [`${machine.id} · 1`, `${machine.id} · 2 ●`],
      keys: 2,
    });
  });
});

describe('the same actor connected again', () => {
  test('gives back the Actor that connect() returned first, and the overlay lists it once', async () => {
    const machine = createCheckoutMachine();
    const actor = start(machine);
    const checkout = connect(actor);
    await mount(null);

    await preview(machine.id, ['payment.error']);
    expect({
      isActor: checkout instanceof Actor,
      again: connect(actor) === checkout,
      returned: connect(checkout) === checkout,
      instances: header().instance?.options,
    }).toEqual({ isActor: true, again: true, returned: true, instances: [`${machine.id} · 1 ●`] });
  });

  test('given an id, the returned actor comes back as it is, without a warning', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine();
    const checkout = connect(start(machine));
    await mount(null);

    const returned = connect(checkout, { id: freshId('other') }) === checkout;
    await flush();
    expect({ returned, machines: header().machine?.options, warnings: output.warn }).toEqual({
      returned: true,
      machines: [machine.id],
      warnings: [],
    });
  });
});

describe('actors that connect() gives back unchanged', () => {
  test.each<[string, () => { actor: AnyActorRef; disabled?: boolean }]>([
    ['a promise actor', () => ({ actor: createActor(fromPromise(() => new Promise<void>(() => {}))).start() })],
    ['a callback actor', () => ({ actor: createActor(fromCallback(() => () => {})).start() })],
    ['an actor with disabled set', () => ({ actor: createActor(createCheckoutMachine()).start(), disabled: true })],
    [
      'an actor that already stopped',
      () => {
        const actor = createActor(createCheckoutMachine()).start();
        actor.stop();
        return { actor };
      },
    ],
    [
      'an actor that already reached its final state',
      () => {
        const actor = createActor(createCheckoutMachine()).start();
        for (const type of ['ADD', 'PAY', 'SUCCEED'] as const) actor.send({ type });
        return { actor };
      },
    ],
  ])('%s comes back unchanged, and is not listed', async (_, make) => {
    await mount(null);
    const { actor, disabled } = make();
    onTestFinished(() => {
      actor.stop();
    });

    const returned = connect(actor, { disabled });
    await flush();
    expect({ same: returned === actor, machines: header().machine }).toEqual({ same: true, machines: null });
  });
});

describe('an actor that ends', () => {
  test.each<[string, (actor: Checkout, checkout: Checkout) => void, string]>([
    ['stops', (actor) => actor.stop(), 'stopped'],
    ['is stopped through the actor that connect() returned', (_, checkout) => checkout.stop(), 'stopped'],
    [
      'reaches its final state',
      (actor) => {
        for (const type of ['ADD', 'PAY', 'SUCCEED'] as const) actor.send({ type });
      },
      'done',
    ],
  ])('leaves the overlay, with its preview, when it %s', async (_, end, status) => {
    const machine = createCheckoutMachine();
    const actor = start(machine);
    const checkout = connect(actor);
    await mount(null);
    await preview(machine.id, ['payment.error']);
    const before = header().previewing;

    await act(async () => {
      end(actor, checkout);
    });
    const { previewing, releaseAll, machine: machines } = header();
    expect({ before, status: actor.getSnapshot().status, previewing, releaseAll, machines }).toEqual({
      before: '1 previewing',
      status,
      previewing: '',
      releaseAll: 'disabled',
      machines: null,
    });
  });
});

describe('an actor connected before it starts', () => {
  test('is listed at once, and start() on the returned actor starts it as the same instance', async () => {
    const machine = createCheckoutMachine();
    const actor = createActor(machine);
    onTestFinished(() => {
      actor.stop();
    });
    const checkout = connect(actor);
    await mount(<CheckoutView actor={checkout} />);
    const instances = header().instance?.options;
    const keys = instanceKeys();

    let started: unknown;
    await act(async () => {
      started = checkout.start();
      checkout.send({ type: 'ADD' });
    });
    expect({ instances, returned: started === checkout, shown: shown(), keys: instanceKeys() }).toEqual({
      instances: [`${machine.id} · 1`],
      returned: true,
      shown: { value: 'cart', items: 1 },
      keys,
    });
  });

  test.each<[string, (actor: Checkout, checkout: Checkout) => void]>([
    ['through the actor that connect() returned', (_, checkout) => checkout.stop()],
    ['through the actor itself', (actor) => actor.stop()],
  ])('leaves the overlay when it is stopped %s without starting', async (_, stop) => {
    const machine = createCheckoutMachine();
    const actor = createActor(machine);
    const checkout = connect(actor);
    await mount(null);
    const before = header().machine?.options;

    await act(async () => {
      stop(actor, checkout);
    });
    expect({ before, after: header().machine }).toEqual({ before: [machine.id], after: null });
  });
});

describe('an actor that a hook runs', () => {
  const SYSTEM_ID = 'toggle';
  const HOOK_ACTOR_WARNING =
    "[state-viewer] connect() was given an actor that a hook already registers, so it keeps the hook's id and label.";

  type ToggleMachine = ReturnType<typeof createToggleMachine>;
  type Hook = { actor?: AnyActorRef };
  type Actors = { hook: AnyActorRef; real: AnyActorRef };

  /** Keeps the actor that useMachine returns in `hook`, as an app that hands it on does. */
  function Toggle({ machine, hook }: { machine: ToggleMachine; hook: Hook }) {
    const [snapshot, , actor] = useMachine(machine, { systemId: SYSTEM_ID });
    hook.actor = actor;
    return <output aria-label="toggle">{JSON.stringify(snapshot.value)}</output>;
  }

  /** The hook's actor, and the real actor behind it, which app code finds through the system. */
  function actorsOf(hook: Hook): Actors {
    if (!hook.actor) throw new Error('The toggle did not render.');
    return { hook: hook.actor, real: hook.actor.system.get(SYSTEM_ID) as AnyActorRef };
  }

  test("connect() gives back the hook's actor, and the hook's instance stays the one listed and previewed", async () => {
    const output = watchConsole();
    const machine = createToggleMachine();
    const hook: Hook = {};
    const view = await mount(<Toggle machine={machine} hook={hook} />);
    const actors = actorsOf(hook);

    const returned = { real: connect(actors.real) === actors.hook, hook: connect(actors.hook) === actors.hook };
    await flush();
    await preview(machine.id, ['on']);
    const previewing = { instances: header().instance?.options, shown: shown('toggle') };
    view.rerender(page(<Toggle machine={machine} hook={hook} />));
    await flush();
    const rerendered = { instances: header().instance?.options, shown: shown('toggle') };
    await release(machine.id);
    expect({ returned, previewing, rerendered, released: shown('toggle'), warnings: output.warn }).toEqual({
      returned: { real: true, hook: true },
      previewing: { instances: [`${machine.id} · 1 ●`], shown: 'on' },
      rerendered: { instances: [`${machine.id} · 1 ●`], shown: 'on' },
      released: 'off',
      warnings: [
        `[state-viewer] No recorded or fixture context for "on" on "${shownKey()}", so the preview uses the live context.`,
      ],
    });
  });

  test.each([
    ['the real actor first', (actors: Actors) => [actors.real, actors.hook]],
    ["the hook's actor first", (actors: Actors) => [actors.hook, actors.real]],
  ])("given an id or a label, with %s, connect() warns once and keeps the hook's id and label", async (_, order) => {
    const output = watchConsole();
    const machine = createToggleMachine();
    const hook: Hook = {};
    await mount(<Toggle machine={machine} hook={hook} />);
    const actors = actorsOf(hook);
    const [first, second] = order(actors);

    const returned = [
      connect(first, { id: freshId('other') }),
      connect(first, { label: 'Other toggle' }),
      connect(second, { id: freshId('other'), label: 'Other toggle' }),
      connect(second, { label: 'Other toggle' }),
    ].map((actor) => actor === actors.hook);
    await flush();
    const { machine: machines, instance } = header();
    expect({ returned, machines: machines?.options, instances: instance?.options, warnings: output.warn }).toEqual({
      returned: [true, true, true, true],
      machines: [machine.id],
      instances: [`${machine.id} · 1`],
      warnings: [HOOK_ACTOR_WARNING],
    });
  });
});

describe('an actor that is not the root of its system', () => {
  test('is listed alone, while its parent and its siblings move', async () => {
    const auth = createMachine({
      id: freshId('auth'),
      initial: 'signedOut',
      states: { signedOut: { on: { SIGN_IN: 'signedIn' } }, signedIn: {} },
    });
    const settings = createMachine({
      id: freshId('settings'),
      initial: 'closed',
      states: { closed: { on: { OPEN: 'open' } }, open: {} },
    });
    const appMachine = setup({
      types: { events: {} as { type: 'TOGGLE' } | { type: 'OPEN_SETTINGS' } },
      actors: { auth, settings },
    }).createMachine({
      id: freshId('app'),
      invoke: [
        { id: 'auth', systemId: 'auth', src: 'auth' },
        { id: 'settings', src: 'settings' },
      ],
      initial: 'light',
      on: { OPEN_SETTINGS: { actions: sendTo('settings', { type: 'OPEN' }) } },
      states: { light: { on: { TOGGLE: 'dark' } }, dark: { on: { TOGGLE: 'light' } } },
    });
    const app = start(appMachine);
    connect(app.system.get('auth'));
    await mount(null);

    const machines = () => header().machine?.options;
    const steps = [machines()];
    for (const type of ['TOGGLE', 'OPEN_SETTINGS'] as const) {
      await act(async () => {
        app.send({ type });
      });
      steps.push(machines());
    }
    expect(steps).toEqual([[auth.id], [auth.id], [auth.id]]);
  });
});

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
