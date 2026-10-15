// Verifies a reviewer's claim: previewing a top-level final state gives a snapshot with status 'done' but no output,
// while the real actor in the same configuration and context has the machine's output.
import { act, render, screen } from '@testing-library/react';
import * as React from 'react';
import { beforeEach, describe, expect, test } from 'vitest';
import { assign, createActor, setup } from 'xstate';
import { defineFixtures, useMachine } from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

const cartMachine = setup({
  types: {
    context: {} as { items: number[] },
    events: {} as { type: 'ADD'; price: number } | { type: 'PAY' },
    output: {} as { total: number },
  },
}).createMachine({
  id: 'cart',
  context: { items: [] },
  initial: 'shopping',
  states: {
    shopping: {
      on: {
        ADD: { actions: assign({ items: ({ context, event }) => [...context.items, event.price] }) },
        PAY: 'paid',
      },
    },
    paid: { type: 'final' },
  },
  output: ({ context }) => ({ total: context.items.reduce((sum, price) => sum + price, 0) }),
});

class Boundary extends React.Component<{ children: React.ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <output data-testid="cart">{`crashed: ${this.state.error.message}`}</output> : this.props.children;
  }
}

let shown: ReturnType<typeof cartMachine.resolveState> | undefined;

function Cart() {
  const [state] = useMachine(cartMachine);
  shown = state;
  // The usual way to read a machine's result once it's done.
  return <output data-testid="cart">{state.status === 'done' ? `paid ${state.output.total}` : 'shopping'}</output>;
}

beforeEach(() => {
  resetRegistry();
  shown = undefined;
});

describe('previewing a top-level final state', () => {
  test('the real actor reaching the final state has the machine output', () => {
    const actor = createActor(cartMachine).start();
    for (const price of [1, 2, 3]) actor.send({ type: 'ADD', price });
    actor.send({ type: 'PAY' });
    expect(actor.getSnapshot()).toMatchObject({ status: 'done', value: 'paid', output: { total: 6 } });
  });

  test('the preview carries the output the machine computes from the previewed context, like the real snapshot', async () => {
    act(() => registry().registerFixtures([defineFixtures(cartMachine, { paid: { context: { items: [1, 2, 3] } } })]));
    render(
      <Boundary>
        <Cart />
      </Boundary>,
    );
    await flush();
    expect(screen.getByTestId('cart').textContent).toBe('shopping');

    const key = keyOf(onlyHandle('cart'));
    act(() => registry().preview(key, { leaves: ['paid'] }));
    expect(registry().getOverride(key)).toMatchObject({ source: 'fixture', context: { items: [1, 2, 3] } });

    expect(shown).toMatchObject({ status: 'done', value: 'paid', context: { items: [1, 2, 3] } });
    expect(shown?.output).toEqual({ total: 6 });
    expect(screen.getByTestId('cart').textContent).toBe('paid 6');
  });
});
