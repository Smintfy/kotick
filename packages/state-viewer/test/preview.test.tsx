import { act, fireEvent, render, screen } from '@testing-library/react';
import { StateViewer, type FixturesInput } from 'state-viewer';
import { connect, defineFixtures, useMachine, useSelector } from 'state-viewer/xstate';
import { describe, expect, onTestFinished, test } from 'vitest';
import { assign, createActor, setup, type Actor, type EventFrom } from 'xstate';
import { watchConsole } from './support/console';
import {
  clickLeaf,
  flush,
  freshId,
  header,
  overlay,
  panel,
  pickSource,
  preview,
  release,
  releaseAll,
  show,
  shownKey,
} from './support/panel';

function createCheckoutMachine() {
  return setup({
    types: {
      context: {} as { step: number; note: string },
      events: {} as { type: 'START' } | { type: 'FAIL'; note: string } | { type: 'EXPRESS' },
    },
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
      <StateViewer defaultOpen fixtures={fixtures} />
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
      <StateViewer defaultOpen fixtures={fixtures} />
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

const LIVE_WARNING = 'No recording or fixture for this state, so the preview uses live context.';

function liveWarning(leaves: string, key: string) {
  return `[state-viewer] No recorded or fixture context for "${leaves}" on "${key}", so the preview uses the live context.`;
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
        <StateViewer defaultOpen />
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
      previewing: header().previewing,
      instances: header().instance?.options,
    }).toEqual({
      first: 'idle',
      second: { paying: { card: 'error', shipping: 'standard' } },
      note: 'typed before the preview',
      previewed: ['paying.card.error'],
      previewing: '1 previewing',
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
        <StateViewer defaultOpen />
      </>,
    );
    await flush();
    await preview(first.id, ['done']);
    await preview(second.id, ['done']);

    const seen = () => {
      const { previewing, releaseAll, machine } = header();
      const machines = machine?.options;
      return { first: shown('first').value, second: shown('second').value, previewing, releaseAll, machines };
    };
    await release(first.id);
    const one = seen();
    await releaseAll();
    expect({ one, all: seen() }).toEqual({
      one: {
        first: 'idle',
        second: 'done',
        previewing: '1 previewing',
        releaseAll: 'enabled',
        machines: [first.id, `${second.id} ●`],
      },
      all: { first: 'idle', second: 'idle', previewing: '', releaseAll: 'disabled', machines: [first.id, second.id] },
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
        instance: `${machine.id} · 1 ●`,
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
        instance: `${machine.id} · 1 ●`,
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
    const none = { value: shown().value, previewed: panel().previewed, previewing: header().previewing };
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
        instance: `${machine.id} · 1 ●`,
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
        `[state-viewer] No fixture context for "paying.card.error" on "${key}", so the preview uses the recorded context.`,
      ],
    });
  });
});
