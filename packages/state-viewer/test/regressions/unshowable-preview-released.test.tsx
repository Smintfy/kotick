// After Fast Refresh turns a previewed parallel state into a compound one (same machine id and leaf ids), the
// override's leaves can no longer be active together. Every leaf still exists, but the new handle's normalizeTarget
// drops one, so the registry releases the override, as it does one that names a leaf the new tree doesn't
// have: the app is on screen in its real state, and the events it sends reach the actor rather than being logged as
// blocked "in" a configuration that isn't shown.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createMachine, type AnyStateMachine } from 'xstate';
import { useMachine } from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

function createCheckout(paying: 'parallel' | 'compound') {
  return createMachine({
    id: 'checkout',
    initial: 'cart',
    states: {
      cart: { on: { PAY: 'paying' } },
      paying: {
        ...(paying === 'parallel' ? { type: 'parallel' as const } : { initial: 'card' }),
        states: {
          card: { initial: 'idle', states: { idle: {}, error: {} } },
          shipping: { initial: 'standard', states: { standard: {}, express: {} } },
        },
      },
    },
  });
}

beforeEach(() => {
  resetRegistry();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

function Checkout({ logic }: { logic: AnyStateMachine }) {
  const [snapshot, send] = useMachine(logic);
  return (
    <button type="button" onClick={() => send({ type: 'PAY' })}>
      {JSON.stringify(snapshot.value)}
    </button>
  );
}

test('once the proxy shows the real snapshot of an override it cannot resolve, the app’s events reach the actor', async () => {
  const view = render(<Checkout logic={createCheckout('parallel')} />);
  await flush();
  const key = keyOf(onlyHandle('checkout'));
  act(() => registry().preview(key, { leaves: ['paying.card.error', 'paying.shipping.express'] }));
  await flush();

  // Fast Refresh: `paying` is now compound, so card and shipping can't be active together.
  view.rerender(<Checkout logic={createCheckout('compound')} />);
  await flush();
  // The proxy shows the real state: the user sees the cart, as if nothing were previewed.
  expect(screen.getByRole('button').textContent).toBe('"cart"');

  // The user clicks Pay.
  fireEvent.click(screen.getByRole('button'));
  await flush();

  expect(registry().getSnapshot().log.filter((entry) => entry.blocked)).toEqual([]);
  expect(screen.getByRole('button').textContent).toBe('{"paying":{"card":"idle"}}');
});
