// Previewing a state: a developer clicks a leaf in the panel, and every component that reads the machine shows that
// state until the preview is released.

import { fireEvent, render, screen } from '@testing-library/react';
import { StateViewer, type FixturesInput } from 'state-viewer';
import { defineFixtures, useMachine } from 'state-viewer/xstate';
import { describe, expect, test } from 'vitest';
import { assign, setup } from 'xstate';
import { watchConsole } from './support/console';
import { flush, freshId, panel, preview, release, shownKey } from './support/panel';

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

function Checkout({ machine }: { machine: CheckoutMachine }) {
  const [snapshot, send] = useMachine(machine);
  return (
    <>
      <output>{JSON.stringify({ value: snapshot.value, context: snapshot.context })}</output>
      <button type="button" onClick={() => send({ type: 'START' })}>
        Start
      </button>
      <button type="button" onClick={() => send({ type: 'EXPRESS' })}>
        Express
      </button>
    </>
  );
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

async function press(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
  await flush();
}

/** What the checkout component shows. */
function shown() {
  return JSON.parse(screen.getByRole('status').textContent ?? 'null');
}

const LIVE_WARNING = 'No recording or fixture for this state, so the preview uses live context.';

/** The console warning for a preview that falls back to the live context. */
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
});
