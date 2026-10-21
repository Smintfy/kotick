import { act, fireEvent, render, screen } from '@testing-library/react';
import { Konat, type FixturesInput } from 'konat';
import { connect, defineFixtures, useMachine, useSelector } from 'konat/xstate';
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
import { REACT_MAJOR } from './support/hooks';
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

/** A parallel root whose `document` region holds a nested parallel state, `saving`. */
function createEditorMachine() {
  return createMachine({
    id: freshId('editor'),
    type: 'parallel',
    states: {
      document: {
        initial: 'clean',
        on: { SAVE: '.saving' },
        states: {
          clean: {},
          saving: {
            type: 'parallel',
            states: {
              upload: { initial: 'pending', states: { pending: {}, failed: {} } },
              // After PROGRESS, the current leaf is neither the initial leaf nor the first one.
              progress: { initial: 'zero', on: { PROGRESS: '.full' }, states: { half: {}, zero: {}, full: {} } },
              spinner: {},
            },
          },
        },
      },
      theme: { initial: 'light', on: { DARK: '.dark' }, states: { light: {}, dark: {} } },
    },
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
  test('a state with no recording or fixture previews with the live context, and warns', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine();
    await mount(machine);
    await press('Start');
    await press('Express');

    await preview(machine.id, ['done']);
    expect({ shown: shown(), panel: panel(), warnings: output.warn }).toEqual({
      shown: { value: 'done', context: { step: 2, note: 'none' } },
      panel: {
        instance: `${machine.id} · 1`,
        live: ['paying.card.idle', 'paying.shipping.express'],
        previewed: ['done'],
        filled: [],
        source: 'live',
        context: ['step: 2', 'note: "none"'],
        warning: LIVE_WARNING,
      },
      warnings: [liveWarning('done', shownKey())],
    });
  });

  test('the context comes from a recording, then from a fixture, then from the live actor', async () => {
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
      warnings: output.warn,
    }).toEqual({
      before: { source: 'none', context: ['step: 2', 'note: "none"'] },
      standard: 'recorded: {"step":1,"note":"none"}',
      error: 'fixture: {"step":8,"note":"card error"}',
      done: 'live: {"step":2,"note":"none"}',
      warnings: [liveWarning('done', shownKey())],
    });
  });

  test('a picked source shows its own context, and the switcher offers only the sources that have some', async () => {
    const machine = createCheckoutMachine();
    await mount(machine, [
      defineFixtures(machine, { 'paying.shipping.standard': { context: { step: 7, note: 'standard shipping' } } }),
    ]);
    await press('Start');
    await press('Express');
    const seen = () => ({ sources: sources(), previewed: panel().previewed, context: shown().context });

    await preview(machine.id, ['paying.shipping.standard']);
    const steps = [seen()];

    for (const source of ['fixture', 'live', 'recorded'] as const) {
      await pickSource(source);
      steps.push(seen());
    }

    await preview(machine.id, ['done']);
    steps.push(seen());
    const standard = ['paying.shipping.standard'];
    expect(steps).toEqual([
      {
        sources: { recorded: 'checked', fixture: 'enabled', live: 'enabled' },
        previewed: standard,
        context: { step: 1, note: 'none' },
      },
      {
        sources: { recorded: 'enabled', fixture: 'checked', live: 'enabled' },
        previewed: standard,
        context: { step: 7, note: 'standard shipping' },
      },
      {
        sources: { recorded: 'enabled', fixture: 'enabled', live: 'checked' },
        previewed: standard,
        context: { step: 2, note: 'none' },
      },
      {
        sources: { recorded: 'checked', fixture: 'enabled', live: 'enabled' },
        previewed: standard,
        context: { step: 1, note: 'none' },
      },
      {
        sources: { recorded: 'disabled', fixture: 'disabled', live: 'checked' },
        previewed: ['done'],
        context: { step: 2, note: 'none' },
      },
    ]);
  });

  test('choosing the live context over a fixture is not a fallback, so nothing warns', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine();
    await mount(machine, [defineFixtures(machine, { done: { context: { step: 9, note: 'from a fixture' } } })]);

    await preview(machine.id, ['done'], { source: 'live' });
    expect({ shown: shown(), source: panel().source, warning: panel().warning, warnings: output.warn }).toEqual({
      shown: { value: 'done', context: { step: 0, note: 'none' } },
      source: 'live',
      warning: '',
      warnings: [],
    });
  });
});

describe('parallel regions', () => {
  test('previewing one region keeps the current leaf of the other', async () => {
    const machine = createCheckoutMachine();
    await mount(machine);
    await press('Start');
    await press('Express');

    await preview(machine.id, ['paying.card.error']);
    expect({ shown: shown(), panel: panel() }).toEqual({
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
    });
  });

  test('from outside the parallel state, the other regions start at their initial leaves', async () => {
    const machine = createCheckoutMachine();
    await mount(machine);

    await preview(machine.id, ['paying.shipping.pickup']);
    expect({ value: shown().value, filled: panel().filled }).toEqual({
      value: { paying: { card: 'idle', shipping: 'pickup' } },
      filled: ['paying.card.idle'],
    });
  });

  test('each click previews the leaves picked so far, newest first, and drops an older leaf of the same region', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine();
    await mount(machine);
    await show(machine.id);
    const key = shownKey();

    await preview(machine.id, ['paying.shipping.express', 'paying.card.error']);
    const first = { value: shown().value, previewed: panel().previewed };
    await preview(machine.id, ['paying.card.error', 'paying.card.idle']);
    const second = { value: shown().value, previewed: panel().previewed, filled: panel().filled };
    expect({ first, second, warnings: output.warn }).toEqual({
      first: {
        value: { paying: { card: 'error', shipping: 'express' } },
        previewed: ['paying.card.error', 'paying.shipping.express'],
      },
      second: {
        value: { paying: { card: 'error', shipping: 'standard' } },
        previewed: ['paying.card.error'],
        filled: ['paying.shipping.standard'],
      },
      warnings: [
        liveWarning('paying.card.error', key),
        liveWarning('paying.shipping.express, paying.card.error', key),
        liveWarning('paying.card.idle', key),
        liveWarning('paying.card.error', key),
      ],
    });
  });

  test('a click on a previewed leaf takes it out of the preview, and the last one releases', async () => {
    const machine = createCheckoutMachine();
    await mount(machine);
    await preview(machine.id, ['paying.card.error', 'paying.shipping.express']);

    await clickLeaf('paying.card.error');
    const one = { value: shown().value, previewed: panel().previewed, filled: panel().filled };
    await clickLeaf('paying.shipping.express');
    const none = { value: shown().value, previewed: panel().previewed, previewing: badge() };
    expect({ one, none }).toEqual({
      one: {
        value: { paying: { card: 'idle', shipping: 'express' } },
        previewed: ['paying.shipping.express'],
        filled: ['paying.card.idle'],
      },
      none: { value: 'idle', previewed: [], previewing: '' },
    });
  });

  test('the fixture comes from the picked leaves in order, then from the leaves filled in', async () => {
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
      await noteOf(['paying.card.idle']),
    ]).toEqual(['fixture: card error', 'fixture: standard shipping', 'fixture: card error', 'fixture: standard shipping']);
  });

  test('a leaf that the newest click drops gives no context, even with a fixture', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine();
    await mount(machine, [
      defineFixtures(machine, { 'paying.card.error': { context: { step: 5, note: 'card error' } } }),
    ]);
    await show(machine.id);
    const key = shownKey();

    await preview(machine.id, ['paying.card.error']);
    const before = { source: panel().source, context: shown().context };
    await clickLeaf('paying.card.idle');
    expect({
      before,
      after: { previewed: panel().previewed, source: panel().source, context: shown().context },
      warnings: output.warn,
    }).toEqual({
      before: { source: 'fixture', context: { step: 5, note: 'card error' } },
      after: { previewed: ['paying.card.idle'], source: 'live', context: { step: 0, note: 'none' } },
      warnings: [liveWarning('paying.card.idle', key)],
    });
  });

  test('inside a nested parallel state too, the regions that the click leaves alone keep their current leaves', async () => {
    const machine = createEditorMachine();
    render(
      <>
        <MachineView machine={machine} events={['SAVE', 'PROGRESS', 'DARK']} />
        <Konat defaultOpen />
      </>,
    );
    await flush();

    for (const event of ['SAVE', 'PROGRESS', 'DARK']) await press(event);

    await preview(machine.id, ['document.saving.upload.failed']);
    expect({ value: shown('app').value, filled: panel().filled }).toEqual({
      value: { document: { saving: { upload: 'failed', progress: 'full', spinner: {} } }, theme: 'dark' },
      filled: ['document.saving.progress.full', 'document.saving.spinner', 'theme.dark'],
    });
  });

  test('the state value has its keys in the order that the machine declares them, whatever order the clicks came in', async () => {
    const machine = createEditorMachine();
    render(
      <>
        <MachineView machine={machine} />
        <Konat defaultOpen />
      </>,
    );
    await flush();

    await preview(machine.id, [
      'theme.dark',
      'document.saving.spinner',
      'document.saving.progress.full',
      'document.saving.upload.failed',
    ]);
    expect(screen.getByRole('status', { name: 'app' }).textContent).toBe(
      '{"value":{"document":{"saving":{"upload":"failed","progress":"full","spinner":{}}},"theme":"dark"},' +
        '"context":{},"status":"active"}',
    );
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

  test('a previewed snapshot answers matches, hasTag and can, and can checks guards on the previewed context', async () => {
    const machine = createCartMachine();

    const { actor, proxy } = await connectCart(machine, [
      defineFixtures(machine, { shopping: { context: { items: [5] } } }),
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
    expect({ declined, fixture, live: answers(), real: actor.getSnapshot().can({ type: 'PAY' }) }).toEqual({
      declined: { status: 'active', matches: ['paying', { paying: 'declined' }], tags: ['failed'], can: ['RETRY'] },
      fixture: { status: 'active', matches: ['shopping'], tags: ['editable'], can: ['ADD', 'PAY'] },
      live: { status: 'active', matches: ['shopping'], tags: ['editable'], can: ['ADD'] },
      real: false,
    });
  });

  test('select() reads through the preview, and its subscriber hears each selection that changes', async () => {
    const machine = createCartMachine();

    const { actor, proxy } = await connectCart(machine, [
      defineFixtures(machine, { 'paying.declined': { context: { items: [9, 9, 9] } } }),
    ]);

    const value = proxy.select((snapshot) => snapshot.value);
    const counts: number[] = [];

    const subscription = proxy.select((snapshot) => snapshot.context.items.length).subscribe((count) => {
      counts.push(count);
    });

    await outsideReact(() => actor.send({ type: 'ADD', price: 3 }));
    // PAY changes the state but not the count.
    await outsideReact(() => actor.send({ type: 'PAY' }));
    const before = value.get();

    await preview(machine.id, ['paying.declined']);
    const during = value.get();
    await releaseAll();
    const after = value.get();
    subscription.unsubscribe();
    await preview(machine.id, ['paying.declined']);
    expect({ before, during, after, counts }).toEqual({
      before: { paying: 'pending' },
      during: { paying: 'declined' },
      after: { paying: 'pending' },
      counts: [1, 3, 1],
    });
  });

  test('select() with an equality function skips the selections that it finds equal', async () => {
    const machine = createCartMachine();
    const { proxy } = await connectCart(machine);
    const heard: string[][] = [];
    proxy
      .select(
        (snapshot) => [...snapshot.tags].sort(),
        (a, b) => a.join() === b.join(),
      )
      .subscribe((tags) => {
        heard.push(tags);
      });

    // The state that the actor is in has the same tags.
    await preview(machine.id, ['shopping']);
    await preview(machine.id, ['paying.declined']);
    expect(heard).toEqual([['failed']]);
  });

  test('the rest comes from the real actor: ids, system, logic, emitted events, and the persisted snapshot', async () => {
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
    expect({
      id: proxy.id,
      sessionId: proxy.sessionId,
      system: proxy.system === actor.system,
      logic: proxy.logic === machine,
      // An app lists send and on in the dependencies of its hooks, so each stays the same function.
      stable: { send: proxy.send === proxy.send, on: proxy.on === on },
      added,
      during,
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
    });
  });

  test('start(), stop() and the observable interop give back the proxy, so a chain keeps it', async () => {
    const machine = createCartMachine();
    const { actor, proxy } = await connectCart(machine);
    // XState reads Symbol.observable when something defines it, and '@@observable' when nothing does.
    const interop = 'observable' in Symbol ? Symbol.observable : '@@observable';
    // SAFETY: Partial says only that the proxy can have the method. When it does not, the test fails.
    const observable = (proxy as Partial<Record<typeof interop, () => object>>)[interop]?.();
    const started = proxy.start();
    let stopped: unknown;
    await outsideReact(() => {
      stopped = proxy.stop();
    });
    expect({
      observable: observable === proxy,
      started: started === proxy,
      stopped: stopped === proxy,
      status: actor.getSnapshot().status,
    }).toEqual({ observable: true, started: true, stopped: true, status: 'stopped' });
  });
});

describe('final states', () => {
  test('a previewed final state is done, with the output that the machine computes from the previewed context', async () => {
    const machine = createCartMachine();

    const { actor, proxy } = await connectCart(machine, [
      defineFixtures(machine, { paid: { context: { items: [1, 2, 3] } } }),
    ]);

    await outsideReact(() => actor.send({ type: 'ADD', price: 4 }));

    await preview(machine.id, ['paid']);
    const { status, value, output } = proxy.getSnapshot();
    const real = actor.getSnapshot();
    expect({
      previewed: { status, value, output },
      real: { status: real.status, value: real.value },
      instances: instances(),
    }).toEqual({
      previewed: { status: 'done', value: 'paid', output: { total: 6 } },
      real: { status: 'active', value: 'shopping' },
      instances: [`${machine.id} · 1`],
    });
  });

  test('a parallel root is done once every region is in a final state', async () => {
    const region = { initial: 'sending', states: { sending: {}, sent: { type: 'final' as const } } };

    const machine = createMachine({
      id: freshId('upload'),
      type: 'parallel',
      states: { file: region, thumbnail: region },
    });

    render(
      <>
        <MachineView machine={machine} />
        <Konat defaultOpen />
      </>,
    );
    await flush();

    const seen = () => {
      const { value, status } = shown('app');

      return { value, status };
    };

    await preview(machine.id, ['file.sent', 'thumbnail.sent']);
    const both = seen();
    await preview(machine.id, ['file.sent']);
    expect({ both, one: seen() }).toEqual({
      both: { value: { file: 'sent', thumbnail: 'sent' }, status: 'done' },
      one: { value: { file: 'sent', thumbnail: 'sending' }, status: 'active' },
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
