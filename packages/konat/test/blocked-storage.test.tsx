/// <reference types="vitest/jsdom" />

import { fireEvent, render, screen } from '@testing-library/react';
import { Konat } from 'konat';
import { useMachine } from 'konat/xstate';
import { expect, test } from 'vitest';
import { assign, setup } from 'xstate';
import { watchConsole } from './support/console';
import { flush, freshId, isOpen, marks, overlay, panel, pickCorner, preview, show } from './support/panel';

// A sandboxed frame, or a browser that blocks site data, has no storage: reading localStorage or sessionStorage
// throws. The registry reads sessionStorage once per page, and test/setup.ts can't clear storage on about:blank, so
// this file holds one test.

type CheckoutContext = { step: number; note: string };

type CheckoutEvent = { type: 'START' } | { type: 'FAIL' };

// SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
const machine = setup({
  types: { context: {} as CheckoutContext, events: {} as CheckoutEvent },
}).createMachine({
  id: freshId('checkout'),
  context: { step: 0, note: 'none' },
  initial: 'idle',
  states: {
    idle: { on: { START: { target: 'paying', actions: assign({ step: 1 }) } } },
    paying: { on: { FAIL: { target: 'failed', actions: assign({ step: 2, note: 'Card declined' }) } } },
    failed: {},
  },
});

function Checkout() {
  const [snapshot, send] = useMachine(machine);

  return (
    <>
      <output>{JSON.stringify({ value: snapshot.value, context: snapshot.context })}</output>
      <button type="button" onClick={() => send({ type: 'START' })}>
        Start
      </button>
      <button type="button" onClick={() => send({ type: 'FAIL' })}>
        Fail
      </button>
    </>
  );
}

async function press(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
  await flush();
}

async function clickOverlay(label: string) {
  const button = overlay().querySelector(`button[aria-label="${label}"]`);

  if (!button) throw new Error(`The overlay has no ${label} button.`);
  fireEvent.click(button);
  await flush();
}

const corner = () => overlay().querySelector('[data-position]')?.getAttribute('data-position');

function readable(storage: 'localStorage' | 'sessionStorage'): boolean {
  try {
    return window[storage].length >= 0;
  } catch {
    return false;
  }
}

test('without storage, recordings mark leaves and feed previews from memory, and the panel opens and moves', async () => {
  jsdom.reconfigure({ url: 'about:blank' });
  const output = watchConsole();
  render(
    <>
      <Checkout />
      <Konat />
    </>,
  );
  await flush();

  await clickOverlay('Konat');
  const opened = { open: isOpen(), corner: corner() };
  await pickCorner('Bottom left');
  const moved = corner();

  await press('Start');
  await press('Fail');
  window.dispatchEvent(new Event('pagehide'));
  await show(machine.id);
  const visited = marks();
  await preview(machine.id, ['paying']);
  expect({
    storage: { local: readable('localStorage'), session: readable('sessionStorage') },
    opened,
    moved,
    visited,
    previewed: { shown: screen.getByRole('status').textContent, source: panel().source, context: panel().context },
    output,
  }).toEqual({
    storage: { local: false, session: false },
    opened: { open: true, corner: 'bottom-right' },
    moved: 'bottom-left',
    visited: { idle: ['recorded'], paying: ['recorded'], failed: ['recorded'] },
    previewed: {
      shown: '{"value":"paying","context":{"step":1,"note":"none"}}',
      source: 'recorded',
      context: ['step: 1', 'note: "none"'],
    },
    output: { warn: [], error: [] },
  });
});
