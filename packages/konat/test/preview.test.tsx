import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Konat, type FixturesInput } from 'konat';
import { connect, createActorContext, defineFixtures, useActorRef, useMachine, useSelector } from 'konat/xstate';
import { describe, expect, onTestFinished, test } from 'vitest';
import {
  assign,
  createActor,
  createMachine,
  emit,
  setup,
  type Actor,
  type AnyStateMachine,
  type AnyStateNodeConfig,
  type EventFrom,
} from 'xstate';
import { watchConsole } from './support/console';
import { describeWithActivity, REACT_MAJOR } from './support/react';
import {
  badge,
  blockedEvents,
  clickLeaf,
  flush,
  freshId,
  instanceKeys,
  instances,
  machines,
  overlay,
  panel,
  pickSource,
  preview,
  release,
  releaseAll,
  show,
  shownKey,
} from './support/panel';

declare global {
  /** While it is true, React warns about each update outside act(). Testing Library sets it to true. */
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

type CheckoutContext = { step: number; note: string };

type CheckoutEvent = { type: 'START' } | { type: 'FAIL'; note: string } | { type: 'EXPRESS' };

function createCheckoutMachine() {
  // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
  return setup({
    types: { context: {} as CheckoutContext, events: {} as CheckoutEvent },
    actions: { count: assign({ step: ({ context }) => context.step + 1 }) },
  }).createMachine({
    id: freshId('checkout'),
    context: { step: 0, note: 'none' },
    initial: 'idle',
    states: {
      idle: { on: { START: { target: 'paying', actions: 'count' } } },
      paying: {
        type: 'parallel',
        states: {
          card: {
            initial: 'idle',
            states: {
              idle: { on: { FAIL: { target: 'error', actions: ['count', assign({ note: ({ event }) => event.note })] } } },
              error: {},
            },
          },
          shipping: {
            initial: 'standard',
            on: { EXPRESS: { target: '.express', actions: 'count' } },
            states: { standard: {}, express: {}, pickup: {} },
          },
        },
      },
      done: { type: 'final' },
    },
  });
}

type CheckoutMachine = ReturnType<typeof createCheckoutMachine>;

function Checkout({ machine, name = 'checkout' }: { machine: CheckoutMachine; name?: string }) {
  const [snapshot, send] = useMachine(machine);

  return (
    <>
      <output aria-label={name}>{JSON.stringify({ value: snapshot.value, context: snapshot.context })}</output>
      <input aria-label={`${name} note`} />
      <button type="button" onClick={() => send({ type: 'START' })}>
        Start
      </button>
      <button type="button" onClick={() => send({ type: 'EXPRESS' })}>
        Express
      </button>
    </>
  );
}

/** Shows what a component sees through the proxy that connect() returns. */
function Connected({ actor }: { actor: Actor<CheckoutMachine> }) {
  const snapshot = useSelector(actor, (current) => current);

  return <output aria-label="checkout">{JSON.stringify({ value: snapshot.value, context: snapshot.context })}</output>;
}

async function mount(machine: CheckoutMachine, fixtures?: FixturesInput) {
  render(
    <>
      <Checkout machine={machine} />
      <Konat defaultOpen fixtures={fixtures} />
    </>,
  );
  await flush();
}

/** Starts an actor outside React and shows it through connect(), as an app does for an actor that a module owns. */
async function mountConnected(machine: CheckoutMachine, fixtures?: FixturesInput) {
  const actor = createActor(machine).start();
  onTestFinished(() => {
    actor.stop();
  });
  render(
    <>
      <Connected actor={connect(actor)} />
      <Konat defaultOpen fixtures={fixtures} />
    </>,
  );
  await flush();

  // The module sends to the actor itself, not to the proxy, so a preview doesn't block these events.
  return async (event: EventFrom<CheckoutMachine>) => {
    await act(async () => {
      actor.send(event);
    });
  };
}

async function press(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
  await flush();
}

function shown(name = 'checkout') {
  return JSON.parse(screen.getByRole('status', { name }).textContent ?? 'null');
}

/** Each source of the context switcher: `checked`, `enabled`, or `disabled` when it has no context to give. */
function sources(): Record<string, string> {
  const inputs = overlay().querySelectorAll<HTMLInputElement>('[aria-label="Context source"] input');

  return Object.fromEntries(
    [...inputs].map((input) => [input.value, input.checked ? 'checked' : input.disabled ? 'disabled' : 'enabled']),
  );
}

/**
 * The labels of the rows under the machines on the machine list: `Release all` while a preview is on, then `Settings`.
 * Call it on the machine list, such as after machines().
 */
function listActions(): string[] {
  return [...overlay().querySelectorAll('[data-part="row-label"]')].map((label) => label.textContent ?? '');
}

const LIVE_WARNING = 'No recording or fixture for this state, so the preview uses live context.';

function liveWarning(leaves: string, key: string) {
  return `[konat] No recorded or fixture context for "${leaves}" on "${key}", so the preview uses the live context.`;
}

type CartContext = { items: number[] };

type CartEvent = { type: 'ADD'; price: number } | { type: 'PAY' } | { type: 'RETRY' };

type CartEmitted = { type: 'added'; price: number };

type CartOutput = { total: number };

function createCartMachine() {
  // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
  return setup({
    types: {
      context: {} as CartContext,
      events: {} as CartEvent,
      emitted: {} as CartEmitted,
      output: {} as CartOutput,
    },
    guards: { hasItems: ({ context }) => context.items.length > 0 },
  }).createMachine({
    id: freshId('cart'),
    context: { items: [] },
    initial: 'shopping',
    states: {
      shopping: {
        tags: ['editable'],
        on: {
          ADD: {
            actions: [
              assign({ items: ({ context, event }) => [...context.items, event.price] }),
              emit(({ event }) => ({ type: 'added' as const, price: event.price })),
            ],
          },
          PAY: { guard: 'hasItems', target: 'paying' },
        },
      },
      paying: {
        initial: 'pending',
        states: { pending: { tags: ['busy'] }, declined: { tags: ['failed'], on: { RETRY: 'pending' } } },
      },
      paid: { type: 'final' },
    },
    output: ({ context }) => ({ total: context.items.reduce((sum, price) => sum + price, 0) }),
  });
}

type CartMachine = ReturnType<typeof createCartMachine>;

/** Starts a cart outside React and connects it, as a module that owns an actor does, next to the open overlay. */
async function connectCart(machine: CartMachine, fixtures?: FixturesInput) {
  const actor = createActor(machine, { id: 'main-cart' }).start();
  onTestFinished(() => {
    actor.stop();
  });
  const proxy = connect(actor);
  render(<Konat defaultOpen fixtures={fixtures} />);
  await flush();

  return { actor, proxy };
}

/** Runs what a module does outside React, such as a send, and lets the overlay render what follows. */
async function outsideReact(run: () => void) {
  await act(async () => {
    run();
  });
}

/**
 * Shows the state value, context and status of any machine, with a button for each event in `events`.
 * `rendered` collects the state value of each render.
 */
function MachineView({
  machine,
  events = [],
  rendered,
}: {
  machine: AnyStateMachine;
  events?: string[];
  rendered?: string[];
}) {
  const [snapshot, send] = useMachine(machine);
  rendered?.push(JSON.stringify(snapshot.value));

  return (
    <>
      <output aria-label="app">
        {JSON.stringify({ value: snapshot.value, context: snapshot.context, status: snapshot.status })}
      </output>
      <input aria-label="note" />
      {events.map((type) => (
        <button key={type} type="button" onClick={() => send({ type })}>
          {type}
        </button>
      ))}
    </>
  );
}

type Edit = 'as written' | 'without paying.card.error' | 'with paying made compound' | 'with a gift region';

/** A checkout edited in its source file. Fast Refresh evaluates the file again, so each call makes a new machine. */
function createEditedMachine(id: string, edit: Edit = 'as written') {
  const card: AnyStateNodeConfig =
    edit === 'without paying.card.error'
      ? { initial: 'idle', states: { idle: {} } }
      : { initial: 'idle', states: { idle: {}, error: {} } };

  const shipping = { initial: 'standard', states: { standard: {}, express: {} } };
  const gift = { initial: 'none', states: { none: {}, wrapped: {} } };

  return createMachine({
    id,
    context: { note: 'live' },
    initial: 'cart',
    states: {
      cart: { on: { PAY: 'paying' } },
      paying:
        edit === 'with paying made compound'
          ? { initial: 'card', states: { card, shipping } }
          : {
              type: 'parallel',
              on: { CONFIRM: 'done' },
              states: edit === 'with a gift region' ? { card, shipping, gift } : { card, shipping },
            },
      done: { type: 'final' },
    },
  });
}

test('a previewed state shows in the component until it is released', async () => {
  const machine = createCheckoutMachine();
  await mount(machine);

  await preview(machine.id, ['done']);
  const previewing = { shown: shown(), previewed: panel().previewed };
  await release(machine.id);
  expect({ previewing, released: { shown: shown(), previewed: panel().previewed } }).toEqual({
    previewing: { shown: { value: 'done', context: { step: 0, note: 'none' } }, previewed: ['done'] },
    released: { shown: { value: 'idle', context: { step: 0, note: 'none' } }, previewed: [] },
  });
});

describe('instances', () => {
  test('a click previews the shown instance only, and its component keeps its own state', async () => {
    const machine = createCheckoutMachine();
    render(
      <>
        <Checkout machine={machine} name="first" />
        <Checkout machine={machine} name="second" />
        <Konat defaultOpen />
      </>,
    );
    await flush();
    fireEvent.change(screen.getByLabelText('second note'), { target: { value: 'typed before the preview' } });

    await show(machine.id, 2);
    await clickLeaf('paying.card.error');
    expect({
      first: shown('first').value,
      second: shown('second').value,
      note: screen.getByLabelText<HTMLInputElement>('second note').value,
      previewed: panel().previewed,
      previewing: badge(),
      instances: instances(),
    }).toEqual({
      first: 'idle',
      second: { paying: { card: 'error', shipping: 'standard' } },
      note: 'typed before the preview',
      previewed: ['paying.card.error'],
      previewing: '1',
      instances: [`${machine.id} · 1`, `${machine.id} · 2 ●`],
    });
  });
});

describe('releasing', () => {
  test('Release ends the shown instance’s preview, and Release all ends every one', async () => {
    const first = createCheckoutMachine();
    const second = createCheckoutMachine();
    render(
      <>
        <Checkout machine={first} name="first" />
        <Checkout machine={second} name="second" />
        <Konat defaultOpen />
      </>,
    );
    await flush();
    await preview(first.id, ['done']);
    await preview(second.id, ['done']);

    const seen = async () => ({
      first: shown('first').value,
      second: shown('second').value,
      previewing: badge(),
      machines: await machines(),
      actions: listActions(),
    });

    await release(first.id);
    const one = await seen();
    await releaseAll();
    expect({ one, all: await seen() }).toEqual({
      one: {
        first: 'idle',
        second: 'done',
        previewing: '1',
        machines: [first.id, `${second.id} · previewing`],
        actions: ['Release all', 'Settings'],
      },
      all: { first: 'idle', second: 'idle', previewing: '', machines: [first.id, second.id], actions: ['Settings'] },
    });
  });
});

describe('context', () => {
  test('the context comes from a recording, then from a fixture, then from the live actor with a warning', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine();
    await mount(machine, [
      defineFixtures(machine, {
        'paying.shipping.standard': { context: { step: 7, note: 'standard shipping' } },
        'paying.card.error': { context: { step: 8, note: 'card error' } },
      }),
    ]);
    // The app records each configuration it goes through: Start goes to paying.card.idle and paying.shipping.standard.
    await press('Start');
    await press('Express');
    await show(machine.id);
    const before = { source: panel().source, context: panel().context };

    const contextOf = async (leaf: string) => {
      await preview(machine.id, [leaf]);

      return `${panel().source}: ${JSON.stringify(shown().context)}`;
    };

    expect({
      before,
      standard: await contextOf('paying.shipping.standard'),
      error: await contextOf('paying.card.error'),
      done: await contextOf('done'),
      warning: panel().warning,
      warnings: output.warn,
    }).toEqual({
      before: { source: 'none', context: ['step: 2', 'note: "none"'] },
      standard: 'recorded: {"step":1,"note":"none"}',
      error: 'fixture: {"step":8,"note":"card error"}',
      done: 'live: {"step":2,"note":"none"}',
      warning: LIVE_WARNING,
      warnings: [liveWarning('done', shownKey())],
    });
  });

  test('a picked source shows its own context, and the switcher offers only the sources that have some', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine();
    await mount(machine, [
      defineFixtures(machine, { 'paying.shipping.standard': { context: { step: 7, note: 'standard shipping' } } }),
    ]);
    await press('Start');
    await press('Express');

    const seen = () => ({
      sources: sources(),
      previewed: panel().previewed,
      context: shown().context,
      warning: panel().warning,
    });

    await preview(machine.id, ['paying.shipping.standard']);
    const steps = [seen()];

    // A picked Live source is not a fallback, so it gives no warning.
    for (const source of ['fixture', 'live', 'recorded'] as const) {
      await pickSource(source);
      steps.push(seen());
    }

    await preview(machine.id, ['done']);
    steps.push(seen());
    const standard = ['paying.shipping.standard'];
    expect({ steps, warnings: output.warn }).toEqual({
      steps: [
        {
          sources: { recorded: 'checked', fixture: 'enabled', live: 'enabled' },
          previewed: standard,
          context: { step: 1, note: 'none' },
          warning: '',
        },
        {
          sources: { recorded: 'enabled', fixture: 'checked', live: 'enabled' },
          previewed: standard,
          context: { step: 7, note: 'standard shipping' },
          warning: '',
        },
        {
          sources: { recorded: 'enabled', fixture: 'enabled', live: 'checked' },
          previewed: standard,
          context: { step: 2, note: 'none' },
          warning: '',
        },
        {
          sources: { recorded: 'checked', fixture: 'enabled', live: 'enabled' },
          previewed: standard,
          context: { step: 1, note: 'none' },
          warning: '',
        },
        {
          sources: { recorded: 'disabled', fixture: 'disabled', live: 'checked' },
          previewed: ['done'],
          context: { step: 2, note: 'none' },
          warning: LIVE_WARNING,
        },
      ],
      warnings: [liveWarning('done', shownKey())],
    });
  });
});

describe('parallel regions', () => {
  test('previewing one region keeps the current leaf of the other, and from outside the parallel state its initial leaf', async () => {
    const machine = createCheckoutMachine();
    await mount(machine);
    await preview(machine.id, ['paying.shipping.pickup']);
    const outside = { value: shown().value, filled: panel().filled };
    await release(machine.id);
    await press('Start');
    await press('Express');

    await preview(machine.id, ['paying.card.error']);
    expect({ outside, inside: { shown: shown(), panel: panel() } }).toEqual({
      outside: { value: { paying: { card: 'idle', shipping: 'pickup' } }, filled: ['paying.card.idle'] },
      inside: {
        shown: { value: { paying: { card: 'error', shipping: 'express' } }, context: { step: 2, note: 'none' } },
        panel: {
          instance: `${machine.id} · 1`,
          live: ['paying.card.idle', 'paying.shipping.express'],
          previewed: ['paying.card.error'],
          filled: ['paying.shipping.express'],
          source: 'live',
          context: ['step: 2', 'note: "none"'],
          warning: LIVE_WARNING,
        },
      },
    });
  });

  test('each click adds its leaf, drops an older leaf of its region, or takes out a previewed leaf, and the last one releases', async () => {
    const machine = createCheckoutMachine();
    await mount(machine);
    const seen = () => ({ value: JSON.stringify(shown().value), previewed: panel().previewed, filled: panel().filled });

    // The keys of the value follow the order of the machine, not the order of the clicks.
    await preview(machine.id, ['paying.shipping.express', 'paying.card.error']);
    const both = seen();
    await clickLeaf('paying.card.idle');
    const dropped = seen();
    await clickLeaf('paying.shipping.express');
    const takenOut = seen();
    await clickLeaf('paying.card.idle');
    const last = { value: shown().value, previewed: panel().previewed, badge: badge() };
    expect({ both, dropped, takenOut, last }).toEqual({
      both: {
        value: '{"paying":{"card":"error","shipping":"express"}}',
        previewed: ['paying.card.error', 'paying.shipping.express'],
        filled: [],
      },
      dropped: {
        value: '{"paying":{"card":"idle","shipping":"express"}}',
        previewed: ['paying.card.idle', 'paying.shipping.express'],
        filled: [],
      },
      takenOut: {
        value: '{"paying":{"card":"idle","shipping":"standard"}}',
        previewed: ['paying.card.idle'],
        filled: ['paying.shipping.standard'],
      },
      last: { value: 'idle', previewed: [], badge: '' },
    });
  });

  test('the fixture comes from the picked leaves that the preview keeps, in order, then from the leaves filled in', async () => {
    const machine = createCheckoutMachine();
    await mount(machine, [
      defineFixtures(machine, {
        'paying.card.error': { context: { step: 1, note: 'card error' } },
        'paying.shipping.standard': { context: { step: 1, note: 'standard shipping' } },
      }),
    ]);

    const noteOf = async (leaves: string[]) => {
      await preview(machine.id, leaves);

      return `${panel().source}: ${shown().context.note}`;
    };

    expect([
      await noteOf(['paying.card.error']),
      await noteOf(['paying.shipping.standard', 'paying.card.error']),
      await noteOf(['paying.card.error', 'paying.shipping.standard']),
      // The click on card.idle drops card.error, so the fixture of card.error doesn't count.
      await noteOf(['paying.card.idle', 'paying.card.error']),
    ]).toEqual(['fixture: card error', 'fixture: standard shipping', 'fixture: card error', 'fixture: standard shipping']);
  });
});

describe('an actor that moves on during a preview', () => {
  test('the preview keeps the context and the leaves that it started with', async () => {
    const machine = createCheckoutMachine();
    const send = await mountConnected(machine);
    await send({ type: 'START' });

    await preview(machine.id, ['paying.card.error']);
    await send({ type: 'EXPRESS' });
    expect({ shown: shown(), panel: panel() }).toEqual({
      shown: { value: { paying: { card: 'error', shipping: 'standard' } }, context: { step: 1, note: 'none' } },
      panel: {
        instance: `${machine.id} · 1`,
        live: ['paying.card.idle', 'paying.shipping.express'],
        previewed: ['paying.card.error'],
        filled: ['paying.shipping.standard'],
        source: 'live',
        context: ['step: 1', 'note: "none"'],
        warning: LIVE_WARNING,
      },
    });
  });

  test('a picked source without context in the current state falls back in the usual order, and warns', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine();

    const send = await mountConnected(machine, [
      defineFixtures(machine, { 'paying.shipping.standard': { context: { step: 7, note: 'standard shipping' } } }),
    ]);

    await show(machine.id);
    const key = shownKey();
    await send({ type: 'START' });
    await send({ type: 'FAIL', note: 'declined' });

    // The fixture of the filled-in leaf paying.shipping.standard makes Fixture available.
    await preview(machine.id, ['paying.card.error']);
    const offered = sources();
    await send({ type: 'EXPRESS' });
    await pickSource('fixture');
    expect({ offered, shown: shown(), source: panel().source, filled: panel().filled, warnings: output.warn }).toEqual({
      offered: { recorded: 'checked', fixture: 'enabled', live: 'enabled' },
      shown: { value: { paying: { card: 'error', shipping: 'express' } }, context: { step: 3, note: 'declined' } },
      source: 'recorded',
      filled: ['paying.shipping.express'],
      warnings: [
        `[konat] No fixture context for "paying.card.error" on "${key}", so the preview uses the recorded context.`,
      ],
    });
  });
});

describe('an actor read outside React', () => {
  test('getSnapshot gives the real snapshot, one previewed snapshot while a preview lasts, then the real one again', async () => {
    const machine = createCartMachine();
    const { actor, proxy } = await connectCart(machine);
    // useActor hands getSnapshot to useSyncExternalStore without the proxy.
    const { getSnapshot } = proxy;
    const isReal = () => getSnapshot() === actor.getSnapshot();
    await outsideReact(() => actor.send({ type: 'ADD', price: 3 }));
    const idle = { isReal: isReal(), value: getSnapshot().value };

    await preview(machine.id, ['paying.declined']);
    const previewed = getSnapshot();
    await outsideReact(() => actor.send({ type: 'PAY' }));

    // useSyncExternalStore needs the same object on every call while nothing that it shows changes.
    const previewing = {
      value: previewed.value,
      context: previewed.context,
      unchanged: proxy.getSnapshot() === previewed,
      real: actor.getSnapshot().value,
    };

    await release(machine.id);
    const released = { isReal: isReal(), value: getSnapshot().value };
    await preview(machine.id, ['paid']);
    const again = getSnapshot().value;
    await releaseAll();
    expect({ idle, previewing, released, again, releasedAll: isReal() }).toEqual({
      idle: { isReal: true, value: 'shopping' },
      previewing: {
        value: { paying: 'declined' },
        context: { items: [3] },
        unchanged: true,
        real: { paying: 'pending' },
      },
      released: { isReal: true, value: { paying: 'pending' } },
      again: 'paid',
      releasedAll: true,
    });
  });

  test('a previewed snapshot answers matches, hasTag and can on the previewed context, and a final one is done with its output', async () => {
    const machine = createCartMachine();

    const { actor, proxy } = await connectCart(machine, [
      defineFixtures(machine, { shopping: { context: { items: [5] } }, paid: { context: { items: [1, 2, 3] } } }),
    ]);

    const states = ['shopping', 'paying', { paying: 'pending' }, { paying: 'declined' }] as const;
    const events = [{ type: 'ADD', price: 1 }, { type: 'PAY' }, { type: 'RETRY' }] as const;

    const answers = () => {
      const snapshot = proxy.getSnapshot();

      return {
        status: snapshot.status,
        matches: states.filter((state) => snapshot.matches(state)),
        tags: ['editable', 'busy', 'failed'].filter((tag) => snapshot.hasTag(tag)),
        can: events.flatMap((event) => (snapshot.can(event) ? [event.type] : [])),
      };
    };

    await preview(machine.id, ['paying.declined']);
    const declined = answers();
    await preview(machine.id, ['shopping'], { source: 'fixture' });
    const fixture = answers();
    await pickSource('live');
    const live = answers();
    await preview(machine.id, ['paid']);
    const { status, value, output } = proxy.getSnapshot();
    const real = actor.getSnapshot();
    expect({
      declined,
      fixture,
      live,
      paid: { status, value, output },
      real: { status: real.status, value: real.value, canPay: real.can({ type: 'PAY' }) },
      instances: instances(),
    }).toEqual({
      declined: { status: 'active', matches: ['paying', { paying: 'declined' }], tags: ['failed'], can: ['RETRY'] },
      fixture: { status: 'active', matches: ['shopping'], tags: ['editable'], can: ['ADD', 'PAY'] },
      live: { status: 'active', matches: ['shopping'], tags: ['editable'], can: ['ADD'] },
      paid: { status: 'done', value: 'paid', output: { total: 6 } },
      real: { status: 'active', value: 'shopping', canPay: false },
      instances: [`${machine.id} · 1`],
    });
  });

  test('select() reads through the preview, and its subscribers hear each selection that changes', async () => {
    const machine = createCartMachine();

    const { actor, proxy } = await connectCart(machine, [
      defineFixtures(machine, { 'paying.declined': { context: { items: [9, 9, 9] } } }),
    ]);

    const value = proxy.select((snapshot) => snapshot.value);
    const counts: number[] = [];
    const tags: string[][] = [];

    const subscriptions = [
      proxy.select((snapshot) => snapshot.context.items.length).subscribe((count) => {
        counts.push(count);
      }),
      // An equality function skips the selections that it finds equal, such as a new array of the same tags.
      proxy
        .select(
          (snapshot) => [...snapshot.tags],
          (a, b) => a.join() === b.join(),
        )
        .subscribe((selected) => {
          tags.push(selected);
        }),
    ];

    await outsideReact(() => actor.send({ type: 'ADD', price: 3 }));
    // PAY changes the state but not the count.
    await outsideReact(() => actor.send({ type: 'PAY' }));
    const before = value.get();

    await preview(machine.id, ['paying.declined']);
    const during = value.get();
    await releaseAll();
    const after = value.get();

    for (const subscription of subscriptions) subscription.unsubscribe();
    await preview(machine.id, ['paying.declined']);
    expect({ before, during, after, counts, tags }).toEqual({
      before: { paying: 'pending' },
      during: { paying: 'declined' },
      after: { paying: 'pending' },
      counts: [1, 3, 1],
      tags: [['busy'], ['failed'], ['busy']],
    });
  });

  test('the rest comes from the real actor, and start(), stop() and the observable interop give back the proxy', async () => {
    const machine = createCartMachine();
    const { actor, proxy } = await connectCart(machine);
    const added: unknown[] = [];
    // An app can take on() off the actor.
    const { on } = proxy;

    const listener = on('added', (event) => {
      added.push(event);
    });

    await outsideReact(() => proxy.send({ type: 'ADD', price: 3 }));

    await preview(machine.id, ['paying.declined']);
    const persisted = proxy.getPersistedSnapshot();

    const during = {
      persisted: {
        value: 'value' in persisted ? persisted.value : undefined,
        context: 'context' in persisted ? persisted.context : undefined,
        status: persisted.status,
      },
      toJSON: proxy.toJSON(),
      json: JSON.stringify({ ref: proxy }),
    };

    await releaseAll();
    listener.unsubscribe();
    await outsideReact(() => proxy.send({ type: 'ADD', price: 4 }));
    // XState reads Symbol.observable when something defines it, and '@@observable' when nothing does.
    const interop = 'observable' in Symbol ? Symbol.observable : '@@observable';
    // SAFETY: Partial says only that the proxy can have the method. When it does not, the test fails.
    const observable = (proxy as Partial<Record<typeof interop, () => object>>)[interop]?.();
    // A chain such as connect(createActor(machine)).start() keeps the proxy.
    const started = proxy.start();
    let stopped: unknown;
    await outsideReact(() => {
      stopped = proxy.stop();
    });
    expect({
      id: proxy.id,
      sessionId: proxy.sessionId,
      system: proxy.system === actor.system,
      logic: proxy.logic === machine,
      // An app lists send and on in the dependencies of its hooks, so each stays the same function.
      stable: { send: proxy.send === proxy.send, on: proxy.on === on },
      added,
      during,
      chain: { observable: observable === proxy, started: started === proxy, stopped: stopped === proxy },
      status: actor.getSnapshot().status,
    }).toEqual({
      id: 'main-cart',
      sessionId: actor.sessionId,
      system: true,
      logic: true,
      stable: { send: true, on: true },
      added: [{ type: 'added', price: 3 }],
      during: {
        persisted: { value: 'shopping', context: { items: [3] }, status: 'active' },
        toJSON: { xstate$$type: 1, id: 'main-cart' },
        json: '{"ref":{"xstate$$type":1,"id":"main-cart"}}',
      },
      chain: { observable: true, started: true, stopped: true },
      status: 'stopped',
    });
  });
});

describe('a machine that Fast Refresh replaces', () => {
  // The edited machine keeps its id. @xstate/react starts a new actor for its new config, from the old actor's
  // persisted snapshot.
  function App({
    machine,
    fixtures,
    rendered,
  }: {
    machine: AnyStateMachine;
    fixtures?: FixturesInput;
    rendered?: string[];
  }) {
    return (
      <>
        <MachineView machine={machine} events={['PAY', 'CONFIRM']} rendered={rendered} />
        <Konat defaultOpen fixtures={fixtures} />
      </>
    );
  }

  function note() {
    return screen.getByLabelText<HTMLInputElement>('note').value;
  }

  test('the preview shows through the swap, under the same instance key, and the app then drives the new actor', async () => {
    const id = freshId('checkout');
    const rendered: string[] = [];
    const view = render(<App machine={createEditedMachine(id)} rendered={rendered} />);
    await flush();
    fireEvent.change(screen.getByLabelText('note'), { target: { value: 'typed before the edit' } });
    await preview(id, ['paying.card.error']);
    const keys = instanceKeys();

    rendered.length = 0;
    view.rerender(<App machine={createEditedMachine(id)} rendered={rendered} />);
    await flush();
    const swapped = { rendered: [...new Set(rendered)], keys: instanceKeys(), note: note() };
    await releaseAll();
    await show(id);
    await press('PAY');
    expect({ swapped, paid: { value: shown('app').value, live: panel().live } }).toEqual({
      swapped: { rendered: ['{"paying":{"card":"error","shipping":"standard"}}'], keys, note: 'typed before the edit' },
      paid: {
        value: { paying: { card: 'idle', shipping: 'standard' } },
        live: ['paying.card.idle', 'paying.shipping.standard'],
      },
    });
  });

  test.each([
    {
      edit: 'without paying.card.error',
      leaves: ['paying.card.error'],
      error: '"paying.card.error" is not a leaf state of this machine.',
      paid: { paying: { card: 'idle', shipping: 'standard' } },
    },
    {
      edit: 'with paying made compound',
      leaves: ['paying.card.error', 'paying.shipping.express'],
      error: `"paying.card.error" and "paying.shipping.express" can't be active at the same time.`,
      paid: { paying: { card: 'idle' } },
    },
  ] as const)(
    'an edit $edit that the preview can’t show gives the real state at once, warns, and lets events through',
    async ({ edit, leaves, error, paid }) => {
      const output = watchConsole();
      const id = freshId('checkout');
      const rendered: string[] = [];
      const view = render(<App machine={createEditedMachine(id)} rendered={rendered} />);
      await flush();
      fireEvent.change(screen.getByLabelText('note'), { target: { value: 'typed before the edit' } });
      await preview(id, [...leaves]);
      const unshowable = `[konat] Can't show the preview of "${shownKey()}" on this actor; showing its real state. Error: ${error}`;
      const before = output.warn.length;

      rendered.length = 0;
      view.rerender(<App machine={createEditedMachine(id, edit)} rendered={rendered} />);
      await flush();
      const edited = { rendered: [...new Set(rendered)], previewing: badge(), note: note() };
      await press('PAY');
      expect({
        edited,
        paid: shown('app').value,
        blocked: blockedEvents(),
        // Only the first line of each warning. The rest is the stack of the error.
        warnings: output.warn.slice(before).map((warning) => warning.split('\n')[0]),
      }).toEqual({
        edited: { rendered: ['"cart"'], previewing: '', note: 'typed before the edit' },
        paid,
        blocked: [],
        // React 18's StrictMode throws away the first render, and the actor that render made warns too.
        warnings: REACT_MAJOR < 19 ? [unshowable, unshowable] : [unshowable],
      });
    },
  );

  test('an edit that adds a region puts its initial leaf in the preview, where its fixture and the event log find it', async () => {
    const id = freshId('checkout');
    const view = render(<App machine={createEditedMachine(id)} />);
    await flush();
    await preview(id, ['paying.card.error']);
    const before = { source: panel().source, context: shown('app').context };

    // The fixtures file imports the machine, so Fast Refresh evaluates it again with the edit.
    const edited = createEditedMachine(id, 'with a gift region');
    const fixtures = [defineFixtures(edited, { 'paying.gift.none': { context: { note: 'gift fixture' } } })];
    view.rerender(<App machine={edited} fixtures={fixtures} />);
    await flush();
    const after = { value: shown('app').value, source: panel().source, context: shown('app').context };
    await press('CONFIRM');
    expect({ before, after, rows: blockedEvents() }).toEqual({
      before: { source: 'live', context: { note: 'live' } },
      after: {
        value: { paying: { card: 'error', shipping: 'standard', gift: 'none' } },
        source: 'fixture',
        context: { note: 'gift fixture' },
      },
      rows: [`CONFIRM · ${id} · 1 · in paying.card.error, paying.shipping.standard, paying.gift.none`],
    });
  });
});

/** Reads the actor of useActorRef with useSelector. */
function Selected({ machine }: { machine: CheckoutMachine }) {
  const snapshot = useSelector(useActorRef(machine), (current) => current);

  return <output aria-label="checkout">{JSON.stringify({ value: snapshot.value, context: snapshot.context })}</output>;
}

/** Reads the actor of a createActorContext Provider with the context's useSelector. */
function FromContext({ actors }: { actors: ReturnType<typeof createActorContext<CheckoutMachine>> }) {
  const snapshot = actors.useSelector((current) => current);

  return <output aria-label="checkout">{JSON.stringify({ value: snapshot.value, context: snapshot.context })}</output>;
}

describeWithActivity('an Activity that hides the component', () => {
  test.each([
    { reader: 'useMachine', element: (machine: CheckoutMachine) => <Checkout machine={machine} /> },
    { reader: 'useActorRef and useSelector', element: (machine: CheckoutMachine) => <Selected machine={machine} /> },
    {
      reader: 'the useSelector of createActorContext',
      element: (machine: CheckoutMachine) => {
        const actors = createActorContext(machine);

        return (
          <actors.Provider>
            <FromContext actors={actors} />
          </actors.Provider>
        );
      },
    },
  ])('a preview that ends while the component is hidden is not in the first paint that shows it again, with $reader', async ({ element }) => {
    const machine = createCheckoutMachine();
    // The same element on each render, as children from a parent are, so React shows it again without a new render.
    const checkout = element(machine);
    const container = document.body.appendChild(document.createElement('div'));
    const root = createRoot(container);
    onTestFinished(() => {
      act(() => root.unmount());
      container.remove();
    });
    let onPaint: ((text: string | null) => void) | undefined;

    // React runs this layout effect after those of the components before it, at the end of the commit.
    function EndOfCommit({ mode }: { mode: string }) {
      React.useLayoutEffect(() => {
        const resolve = onPaint;

        // A microtask runs after the synchronous renders that the commit starts, and before the browser paints.
        if (resolve) queueMicrotask(() => resolve(screen.getByRole('status', { name: 'checkout' }).textContent));
      }, [mode]);

      return null;
    }

    const app = (mode: 'visible' | 'hidden') => (
      <React.StrictMode>
        <React.Activity mode={mode}>{checkout}</React.Activity>
        <EndOfCommit mode={mode} />
        <Konat defaultOpen />
      </React.StrictMode>
    );

    await act(async () => root.render(app('visible')));
    await flush();
    await preview(machine.id, ['done']);
    const previewing = shown();
    // The hidden component unregisters, and the registry ends its preview.
    await act(async () => root.render(app('hidden')));
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    let painted: string | null;

    try {
      // Outside act, as in an app, so React runs the passive effects after the paint.
      painted = await new Promise((resolve) => {
        onPaint = resolve;
        root.render(app('visible'));
      });
    } finally {
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    }

    expect({ previewing, firstPaint: JSON.parse(painted ?? 'null') }).toEqual({
      previewing: { value: 'done', context: { step: 0, note: 'none' } },
      firstPaint: { value: 'idle', context: { step: 0, note: 'none' } },
    });
  });
});
