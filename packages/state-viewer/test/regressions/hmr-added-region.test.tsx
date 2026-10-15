// A Fast Refresh edit that adds a region to a previewed parallel state keeps the preview (the new handle's
// normalizeTarget keeps every previewed leaf and adds one for the new region), and the app shows the new region. The
// override's `leaves` are the full configuration: the requested leaves first, then the filled-in regions.
// They name that leaf too, so the event log entry of an event the app sends then records the state the UI showed when
// it sent the event, and fixtures registering afterwards are looked up against the leaves normalizeTarget filled in.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createMachine, type AnyStateMachine } from 'xstate';
import { useMachine } from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

/** A checkout whose `paying` step gets a gift-wrap region in a later edit. */
function createCheckout(withGift: boolean) {
  return createMachine({
    id: 'checkout',
    initial: 'cart',
    context: { n: 0 },
    states: {
      cart: { on: { PAY: 'paying' } },
      paying: {
        type: 'parallel',
        on: { CONFIRM: 'done' },
        states: {
          card: { initial: 'idle', states: { idle: {}, error: {} } },
          shipping: { initial: 'standard', states: { standard: {}, express: {} } },
          ...(withGift ? { gift: { initial: 'none', states: { none: {}, wrapped: {} } } } : {}),
        },
      },
      done: { type: 'final' },
    },
  });
}

beforeEach(() => {
  resetRegistry();
  // Previews of states without a recording or fixture warn about falling back to live context.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

function Checkout({ logic }: { logic: AnyStateMachine }) {
  const [snapshot, send] = useMachine(logic);
  return (
    <button type="button" onClick={() => send({ type: 'CONFIRM' })}>
      {JSON.stringify(snapshot.value)}
    </button>
  );
}

/** Previews a declined card, then saves an edit that adds the gift region (Fast Refresh: a new machine object). */
async function previewThenAddRegion() {
  const view = render(<Checkout logic={createCheckout(false)} />);
  await flush();
  const key = keyOf(onlyHandle('checkout'));
  act(() => registry().preview(key, { leaves: ['paying.card.error'] }));
  await flush();

  view.rerender(<Checkout logic={createCheckout(true)} />);
  await flush();
  // The preview survives the edit, and the app shows the new region at its initial leaf.
  expect(registry().getOverride(key)).toBeDefined();
  expect(JSON.parse(screen.getByRole('button').textContent!)).toEqual({
    paying: { card: 'error', shipping: 'standard', gift: 'none' },
  });
  return key;
}

const SHOWN = ['paying.card.error', 'paying.gift.none', 'paying.shipping.standard'];

test("the override's leaves name the region the edit added, which the preview shows", async () => {
  const key = await previewThenAddRegion();

  expect([...registry().getSnapshot().overrides[key].leaves].sort()).toEqual(SHOWN);
});

test('an event blocked after the edit is logged with the configuration the app showed', async () => {
  await previewThenAddRegion();

  fireEvent.click(screen.getByRole('button'));
  await flush();

  const [entry] = registry().getSnapshot().log;
  expect(entry.event).toEqual({ type: 'CONFIRM' });
  expect([...entry.leaves].sort()).toEqual(SHOWN);
});

test('fixtures registering after the edit are looked up against the leaf of the added region', async () => {
  const key = await previewThenAddRegion();

  act(() => registry().registerFixtures([{ machineId: 'checkout', states: { 'paying.gift.none': { context: { n: 42 } } } }]));
  await flush();

  expect(registry().getOverride(key)).toMatchObject({ source: 'fixture', context: { n: 42 } });
});

test('control: without the edit, the override and the log name every region', async () => {
  render(<Checkout logic={createCheckout(true)} />);
  await flush();
  const key = keyOf(onlyHandle('checkout'));
  act(() => registry().preview(key, { leaves: ['paying.card.error'] }));
  await flush();
  expect([...registry().getSnapshot().overrides[key].leaves].sort()).toEqual(SHOWN);

  fireEvent.click(screen.getByRole('button'));
  await flush();
  expect([...registry().getSnapshot().log[0].leaves].sort()).toEqual(SHOWN);
});
