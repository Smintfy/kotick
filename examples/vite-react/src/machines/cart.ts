import { assign, setup } from 'xstate';
import { createActorContext } from 'konat/xstate';
import type { LineItem, Product } from '@/lib/products.ts';

type CartContents = { items: LineItem[] };

type CartEvent = { type: 'ADD'; product: Product } | { type: 'REMOVE'; id: string } | { type: 'CLEAR' };

function addItem(items: LineItem[], product: Product): LineItem[] {
  return items.some((item) => item.id === product.id)
    ? items.map((item) => (item.id === product.id ? { ...item, qty: item.qty + 1 } : item))
    : [...items, { ...product, qty: 1 }];
}

export const cartMachine = setup({
  // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
  types: {
    context: {} as CartContents,
    events: {} as CartEvent,
  },
}).createMachine({
  id: 'cart',
  initial: 'empty',
  context: { items: [] },
  states: {
    empty: {
      on: {
        ADD: { target: 'filled', actions: assign({ items: ({ context, event }) => addItem(context.items, event.product) }) },
      },
    },
    filled: {
      on: {
        ADD: { actions: assign({ items: ({ context, event }) => addItem(context.items, event.product) }) },
        REMOVE: [
          {
            guard: ({ context, event }) => context.items.every((item) => item.id === event.id),
            target: 'empty',
            actions: assign({ items: [] }),
          },
          { actions: assign({ items: ({ context, event }) => context.items.filter((item) => item.id !== event.id) }) },
        ],
        CLEAR: { target: 'empty', actions: assign({ items: [] }) },
      },
    },
  },
});

export const CartContext = createActorContext(cartMachine);
