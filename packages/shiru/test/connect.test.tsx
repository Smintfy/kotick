import { act, screen } from '@testing-library/react';
import { connect, useMachine, useSelector } from 'shiru/xstate';
import { describe, expect, onTestFinished, test } from 'vitest';
import {
  Actor,
  assign,
  createActor,
  createMachine,
  fromPromise,
  setup,
  type AnyActorRef,
  type EventFrom,
} from 'xstate';
import { mount, start, systemActor } from './support/app';
import { errorMessage, uncaught, watchConsole } from './support/console';
import {
  badge,
  flush,
  freshId,
  instanceKeys,
  instances,
  machines,
  preview,
  release,
  show,
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
  const listed = { machines: rows, instances: instances(), shown: shown() };
  await preview(machine.id, ['payment.error']);
  const previewing = shown();
  await release(machine.id);
  expect({ listed, previewing, released: shown() }).toEqual({
    listed: {
      machines: [machine.id],
      instances: [`${machine.id} · 1`],
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
  test('gives back the Actor that connect() returned first, without a warning, and the overlay lists it once', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine();
    const actor = start(machine);
    const checkout = connect(actor);
    await mount(null);

    await show(machine.id);
    expect({
      isActor: checkout instanceof Actor,
      again: connect(actor) === checkout,
      returned: connect(checkout, { id: freshId('other') }) === checkout,
      instances: instances(),
      warnings: output.warn,
    }).toEqual({
      isActor: true,
      again: true,
      returned: true,
      instances: [`${machine.id} · 1`],
      warnings: [],
    });
  });
});

describe('actors that connect() gives back unchanged', () => {
  test.each<[string, () => { actor: AnyActorRef; disabled?: boolean }]>([
    ['a promise actor', () => ({ actor: createActor(fromPromise(() => new Promise<void>(() => {}))).start() })],
    ['an actor with disabled set', () => ({ actor: createActor(createCheckoutMachine()).start(), disabled: true })],
    [
      'an actor that already stopped',
      () => {
        const actor = createActor(createCheckoutMachine()).start();
        actor.stop();

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
    ['is stopped', (_, checkout) => checkout.stop(), 'stopped', []],
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

  test('leaves the overlay when it is stopped without starting', async () => {
    const machine = createCheckoutMachine();
    const checkout = connect(createActor(machine));
    await mount(null);
    const before = await machines();

    await act(async () => {
      checkout.stop();
    });
    expect({ before, after: await machines() }).toEqual({ before: [machine.id], after: [] });
  });
});

describe('an actor that a hook runs', () => {
  const SYSTEM_ID = 'toggle';

  const HOOK_ACTOR_WARNING =
    "[shiru] connect() was given an actor that a hook already registers, so it keeps the hook's id and label.";

  type ToggleMachine = ReturnType<typeof createToggleMachine>;

  type Hook = { actor?: AnyActorRef };

  type Actors = { hook: AnyActorRef; real: AnyActorRef };

  function Toggle({ machine, hook }: { machine: ToggleMachine; hook: Hook }) {
    hook.actor = useMachine(machine, { systemId: SYSTEM_ID })[2];

    return null;
  }

  /** App code finds the real actor behind the hook's actor through the system. */
  function actorsOf(hook: Hook): Actors {
    if (!hook.actor) throw new Error('The toggle did not render.');

    return { hook: hook.actor, real: systemActor(hook.actor, SYSTEM_ID) };
  }

  test("connect() gives back the hook's actor, and given an id or a label, warns once and keeps the hook's id and label", async () => {
    const output = watchConsole();
    const machine = createToggleMachine();
    const hook: Hook = {};
    await mount(<Toggle machine={machine} hook={hook} />);
    const actors = actorsOf(hook);

    const returned = [
      connect(actors.real),
      connect(actors.hook),
      connect(actors.real, { id: freshId('other') }),
      connect(actors.hook, { label: 'Other toggle' }),
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
