// Verifies: an override whose leaves stop being orthogonal after HMR (a parallel state edited into a compound one,
// keeping its leaf ids) must not be rendered as a configuration XState itself could never be in.
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { createMachine, type AnyStateMachine } from 'xstate';
import { useMachine } from '../../src/xstate';
import { resolveSnapshot } from '../../src/xstate/tree';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

function createCheckout(paying: 'parallel' | 'compound') {
  return createMachine({
    id: 'checkout',
    initial: 'cart',
    states: {
      cart: {},
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

let warn: MockInstance;

beforeEach(() => {
  resetRegistry();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('non-orthogonal leaves', () => {
  test('resolveSnapshot refuses leaves from two branches of a compound state', () => {
    const compound = createCheckout('compound');
    expect(() => resolveSnapshot(compound, ['paying.card.error', 'paying.shipping.express'], {})).toThrow();
  });

  test('after HMR turns a previewed parallel state compound, the proxy never shows both branches at once', async () => {
    function Checkout({ logic }: { logic: AnyStateMachine }) {
      const [snapshot] = useMachine(logic);
      const both = snapshot.matches('paying.card') && snapshot.matches('paying.shipping');
      return (
        <output data-testid="checkout" data-both={String(both)}>
          {JSON.stringify(snapshot.value)}
        </output>
      );
    }

    const view = render(<Checkout logic={createCheckout('parallel')} />);
    await flush();
    const key = keyOf(onlyHandle('checkout'));
    registry().preview(key, { leaves: ['paying.card.error', 'paying.shipping.express'] });
    await flush();
    expect(screen.getByTestId('checkout').textContent).toBe('{"paying":{"card":"error","shipping":"express"}}');

    // Same id and leaf ids, but `paying` is now compound: card and shipping are mutually exclusive.
    view.rerender(<Checkout logic={createCheckout('compound')} />);
    await flush();
    expect(keyOf(onlyHandle('checkout'))).toBe(key);

    const output = screen.getByTestId('checkout');
    expect(output.dataset.both).toBe('false');
    expect(output.textContent).not.toBe('{"paying":{"card":"error","shipping":"express"}}');
  });
});
