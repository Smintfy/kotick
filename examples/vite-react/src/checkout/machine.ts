import { assign, fromPromise, not, or, setup, stateIn } from 'xstate';
import type { LineItem } from '../products.ts';

export type CheckoutContext = {
  items: LineItem[];
  /** Item total in cents, before shipping. */
  total: number;
  cardNumber: string;
  error?: string;
  receiptId?: string;
};

export type CheckoutEvent =
  | { type: 'SHIP_STANDARD' }
  | { type: 'SHIP_EXPRESS' }
  | { type: 'SHIP_PICKUP' }
  | { type: 'UPDATE_CARD'; cardNumber: string }
  | { type: 'PAY' }
  | { type: 'RETRY' }
  | { type: 'EDIT_CARD' };

const digitsOf = (cardNumber: string) => cardNumber.replace(/\D/g, '');

// Fake payment provider: any 16-digit card works, except ones ending in 0002.
const charge = fromPromise<{ receiptId: string }, { cardNumber: string }>(async ({ input }) => {
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (digitsOf(input.cardNumber).endsWith('0002')) throw new Error('Card declined');
  return { receiptId: `rcpt_${Math.random().toString(36).slice(2, 8)}` };
});

export const checkoutMachine = setup({
  types: {
    context: {} as CheckoutContext,
    events: {} as CheckoutEvent,
  },
  actors: { charge },
  guards: {
    shippingOpen: not(or([stateIn('#checkout.payment.processing'), stateIn('#checkout.payment.success')])),
  },
}).createMachine({
  id: 'checkout',
  type: 'parallel',
  context: {
    items: [{ id: 'sku_1', name: 'Linen tote', price: 2400, qty: 2 }],
    total: 4800,
    cardNumber: '',
  },
  states: {
    shipping: {
      initial: 'standard',
      on: {
        SHIP_STANDARD: { guard: 'shippingOpen', target: '.standard' },
        SHIP_EXPRESS: { guard: 'shippingOpen', target: '.express' },
        SHIP_PICKUP: { guard: 'shippingOpen', target: '.pickup' },
      },
      states: {
        standard: { description: 'Free, 3 to 5 business days' },
        express: { description: '$15, next business day' },
        pickup: { description: 'Free, collect in store' },
      },
    },
    payment: {
      initial: 'editing',
      states: {
        editing: {
          initial: 'incomplete',
          on: {
            UPDATE_CARD: [
              {
                guard: ({ event }) => digitsOf(event.cardNumber).length === 16,
                target: '.complete',
                actions: assign({ cardNumber: ({ event }) => event.cardNumber }),
              },
              { target: '.incomplete', actions: assign({ cardNumber: ({ event }) => event.cardNumber }) },
            ],
          },
          states: {
            incomplete: {},
            complete: { on: { PAY: '#checkout.payment.processing' } },
            // Lets "Edit card" return to whichever editing state was last active.
            last: { type: 'history' },
          },
        },
        processing: {
          tags: ['busy'],
          description: 'Waiting for the payment provider',
          invoke: {
            src: 'charge',
            input: ({ context }) => ({ cardNumber: context.cardNumber }),
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
          },
        },
        success: { type: 'final', description: 'Payment captured and receipt issued' },
      },
    },
  },
});
