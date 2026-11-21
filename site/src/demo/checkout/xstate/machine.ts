import { and, assign, fromPromise, setup, stateIn } from 'xstate';
import {
  type Card,
  type CheckoutEvent,
  chargeCard,
  emptyCard,
  isCardComplete,
  type LineItem,
  startItems,
  withQty,
} from '@/demo/checkout/order';

export type CheckoutContext = {
  items: LineItem[];
  card: Card;
  error?: string;
  receiptId?: string;
};

const cardAfterUpdate = (card: Card, event: CheckoutEvent): Card =>
  event.type === 'UPDATE_CARD' ? { ...card, [event.field]: event.value } : card;

const charge = fromPromise<{ receiptId: string }, { card: Card }>(({ input }) => chargeCard(input.card));

export const checkoutMachine = setup({
  // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
  types: {
    context: {} as CheckoutContext,
    events: {} as CheckoutEvent,
  },
  actors: { charge },
  actions: {
    updateCard: assign({
      card: ({ context, event }) => cardAfterUpdate(context.card, event),
    }),
  },
  guards: {
    beforePayment: stateIn('#checkout-xstate.payment.idle'),
    hasItems: stateIn('#checkout-xstate.cart.filled'),
    removesLastItem: ({ context, event }) =>
      event.type === 'REMOVE_ITEM' && context.items.every((item) => item.id === event.id),
    cardComplete: ({ context, event }) => isCardComplete(cardAfterUpdate(context.card, event)),
  },
}).createMachine({
  id: 'checkout-xstate',
  type: 'parallel',
  context: { items: startItems, card: emptyCard },
  states: {
    cart: {
      initial: 'filled',
      states: {
        filled: {
          on: {
            SET_QTY: {
              guard: 'beforePayment',
              actions: assign({ items: ({ context, event }) => withQty(context.items, event.id, event.qty) }),
            },
            REMOVE_ITEM: [
              {
                guard: and(['beforePayment', 'removesLastItem']),
                target: 'empty',
                actions: assign({ items: [] }),
              },
              {
                guard: 'beforePayment',
                actions: assign({ items: ({ context, event }) => context.items.filter((item) => item.id !== event.id) }),
              },
            ],
          },
        },
        empty: {
          on: { RESTORE_ITEMS: { target: 'filled', actions: assign({ items: startItems }) } },
        },
      },
    },
    shipping: {
      initial: 'standard',
      on: {
        SHIP_STANDARD: { guard: 'beforePayment', target: '.standard' },
        SHIP_EXPRESS: { guard: 'beforePayment', target: '.express' },
        SHIP_PICKUP: { guard: 'beforePayment', target: '.pickup' },
      },
      states: {
        standard: {},
        express: {},
        pickup: {},
      },
    },
    payment: {
      initial: 'idle',
      states: {
        idle: {
          on: {
            CONTINUE: [
              { guard: and(['hasItems', 'cardComplete']), target: 'editing.complete' },
              { guard: 'hasItems', target: 'editing' },
            ],
          },
        },
        editing: {
          initial: 'incomplete',
          on: {
            BACK: 'idle',
            UPDATE_CARD: [
              { guard: 'cardComplete', target: '.complete', actions: 'updateCard' },
              { target: '.incomplete', actions: 'updateCard' },
            ],
          },
          states: {
            incomplete: {},
            complete: { on: { PAY: '#checkout-xstate.payment.processing' } },
            last: { type: 'history' },
          },
        },
        processing: {
          tags: ['busy'],
          invoke: {
            src: 'charge',
            input: ({ context }) => ({ card: context.card }),
            onDone: { target: 'success', actions: assign({ receiptId: ({ event }) => event.output.receiptId }) },
            onError: {
              target: 'error',
              actions: assign({ error: ({ event }) => (event.error instanceof Error ? event.error.message : 'Payment failed') }),
            },
          },
        },
        error: {
          on: {
            RETRY: 'processing',
            EDIT_CARD: 'editing.last',
            BACK: 'idle',
          },
        },
        success: { type: 'final' },
      },
    },
  },
});
