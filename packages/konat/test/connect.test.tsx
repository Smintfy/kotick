import { act, screen } from '@testing-library/react';
import { connect, useMachine, useSelector } from 'konat/xstate';
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
  type EventFrom,
} from 'xstate';
import { mount, page, start, systemActor } from './support/app';
import { errorMessage, uncaught, watchConsole } from './support/console';
import {
  badge,
  flush,
  freshId,
  instanceKeys,
  instances,
  machines,
  panel,
  preview,
  release,
  show,
  shownKey,
} from './support/panel';

const BROKEN = 'Checkout broken';

type CheckoutContext = { items: number };

type CheckoutEvent = { type: 'ADD' } | { type: 'PAY' } | { type: 'SUCCEED' } | { type: 'NOOP' } | { type: 'BREAK' };

function createCheckoutMachine() {
  return setup({
    // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
    types: { context: {} as CheckoutContext, events: {} as CheckoutEvent },
    guards: { hasItems: ({ context }) => context.items > 0 },
  }).createMachine({
    id: freshId('checkout'),
    context: { items: 0 },
    initial: 'cart',
    on: {
      BREAK: {
        actions: () => {
          throw new Error(BROKEN);
        },
      },
    },
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

/** Shows what a component reads from the actor that connect() returns. */
function CheckoutView({ actor }: { actor: Checkout }) {
  const snapshot = useSelector(actor, (current) => current);

  return <output aria-label="checkout">{JSON.stringify({ value: snapshot.value, items: snapshot.context.items })}</output>;
}

function shown(name = 'checkout') {
  return JSON.parse(screen.getByRole('status', { name }).textContent ?? 'null');
}

async function send(actor: Checkout, ...events: EventFrom<CheckoutMachine>[]) {
  await act(async () => {
    for (const event of events) actor.send(event);
  });
}

test('an actor started outside React and connected is listed, and its preview shows in the component', async () => {
  const machine = createCheckoutMachine();
  const checkout = connect(start(machine));
  await mount(<CheckoutView actor={checkout} />);

  await send(checkout, { type: 'ADD' });
  const rows = await machines();
  await show(machine.id);
  const listed = { machines: rows, instances: instances(), live: panel().live, shown: shown() };
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
    const named = instances();
    expect({ machines: await machines(), instances: named, shown: shown() }).toEqual({
      machines: [`${id} · previewing`],
      instances: ['Header cart · 1'],
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
    expect({ instances: instances(), keys: new Set(instanceKeys()).size }).toEqual({
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
      instances: instances(),
    }).toEqual({ isActor: true, again: true, returned: true, instances: [`${machine.id} · 1`] });
  });

  test('given an id, the returned actor comes back as it is, without a warning', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine();
    const checkout = connect(start(machine));
    await mount(null);

    const returned = connect(checkout, { id: freshId('other') }) === checkout;
    await flush();
    expect({ returned, machines: await machines(), warnings: output.warn }).toEqual({
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
    expect({ same: returned === actor, machines: await machines() }).toEqual({ same: true, machines: [] });
  });
});

describe('an actor that ends', () => {
  test.each<[string, (actor: Checkout, checkout: Checkout) => void, string, string[]]>([
    ['stops', (actor) => actor.stop(), 'stopped', []],
    ['is stopped through the actor that connect() returned', (_, checkout) => checkout.stop(), 'stopped', []],
    [
      'reaches its final state',
      (actor) => {
        for (const type of ['ADD', 'PAY', 'SUCCEED'] as const) actor.send({ type });
      },
      'done',
      [],
    ],
    // No observer handles the error, so XState reports it, as without connect().
    ['fails', (actor) => actor.send({ type: 'BREAK' }), 'error', [BROKEN]],
  ])('leaves the overlay, with its preview, when it %s', async (_, end, status, reported) => {
    const machine = createCheckoutMachine();
    const actor = start(machine);
    const checkout = connect(actor);
    await mount(null);
    await preview(machine.id, ['payment.error']);
    const before = badge();

    const errors = await uncaught(() => end(actor, checkout));
    expect({
      before,
      status: actor.getSnapshot().status,
      uncaught: errors.map(errorMessage),
      previewing: badge(),
      machines: await machines(),
    }).toEqual({
      before: '1',
      status,
      uncaught: reported,
      previewing: '',
      machines: [],
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
    await show(machine.id);
    const listed = instances();
    const keys = instanceKeys();

    let started: unknown;
    await act(async () => {
      started = checkout.start();
      checkout.send({ type: 'ADD' });
    });
    expect({ instances: listed, returned: started === checkout, shown: shown(), keys: instanceKeys() }).toEqual({
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
    const before = await machines();

    await act(async () => {
      stop(actor, checkout);
    });
    expect({ before, after: await machines() }).toEqual({ before: [machine.id], after: [] });
  });

  test('leaves the overlay when an action of its initial state throws as it starts', async () => {
    const machine = createMachine({
      id: freshId('greeting'),
      initial: 'shown',
      states: {
        shown: {
          entry: () => {
            throw new Error('Greeting broken');
          },
        },
      },
    });

    const actor = createActor(machine);
    onTestFinished(() => {
      actor.stop();
    });
    const greeting = connect(actor);
    await mount(null);
    const before = await machines();

    const errors = await uncaught(() => greeting.start());
    expect({
      before,
      status: greeting.getSnapshot().status,
      uncaught: errors.map(errorMessage),
      after: await machines(),
    }).toEqual({ before: [machine.id], status: 'error', uncaught: ['Greeting broken'], after: [] });
  });
});

describe('an actor that a hook runs', () => {
  const SYSTEM_ID = 'toggle';

  const HOOK_ACTOR_WARNING =
    "[konat] connect() was given an actor that a hook already registers, so it keeps the hook's id and label.";

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

    return { hook: hook.actor, real: systemActor(hook.actor, SYSTEM_ID) };
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
    const previewing = { instances: instances(), shown: shown('toggle') };
    view.rerender(page(<Toggle machine={machine} hook={hook} />));
    await flush();
    const rerendered = { instances: instances(), shown: shown('toggle') };
    await release(machine.id);
    expect({ returned, previewing, rerendered, released: shown('toggle'), warnings: output.warn }).toEqual({
      returned: { real: true, hook: true },
      previewing: { instances: [`${machine.id} · 1`], shown: 'on' },
      rerendered: { instances: [`${machine.id} · 1`], shown: 'on' },
      released: 'off',
      warnings: [
        `[konat] No recorded or fixture context for "on" on "${shownKey()}", so the preview uses the live context.`,
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
    const rows = await machines();
    await show(machine.id);
    expect({ returned, machines: rows, instances: instances(), warnings: output.warn }).toEqual({
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

    type AppEvent = { type: 'TOGGLE' } | { type: 'OPEN_SETTINGS' };

    const appMachine = setup({
      // SAFETY: XState reads the types of setup() only at compile time. It never reads this value.
      types: { events: {} as AppEvent },
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

    const steps = [await machines()];

    for (const type of ['TOGGLE', 'OPEN_SETTINGS'] as const) {
      await act(async () => {
        app.send({ type });
      });
      steps.push(await machines());
    }

    expect(steps).toEqual([[auth.id], [auth.id], [auth.id]]);
  });
});
