import { and, assign, fromPromise, setup, stateIn } from 'xstate';

type Cents = number;

type LineItem = {
  id: string;
  name: string;
  price: Cents;
  qty: number;
};

export type Card = {
  number: string;
  expiry: string;
  cvc: string;
};

export type CheckoutContext = {
  items: LineItem[];
  card: Card;
  error?: string;
  receiptId?: string;
};

export type CheckoutEvent =
  | { type: 'SET_QTY'; id: string; qty: number }
  | { type: 'REMOVE_ITEM'; id: string }
  | { type: 'RESTORE_ITEMS' }
  | { type: 'CONTINUE' }
  | { type: 'BACK' }
  | { type: 'SHIP_STANDARD' }
  | { type: 'SHIP_EXPRESS' }
  | { type: 'SHIP_PICKUP' }
  | { type: 'UPDATE_CARD'; field: keyof Card; value: string }
  | { type: 'PAY' }
  | { type: 'RETRY' }
  | { type: 'EDIT_CARD' };

export const maxQty = 9;

export const startItems: LineItem[] = [
  { id: 'sku_1', name: 'Linen tote', price: 2400, qty: 2 },
  { id: 'sku_2', name: 'Canvas pouch', price: 1200, qty: 1 },
];

export const emptyCard: Card = { number: '', expiry: '', cvc: '' };

export const digitsOf = (value: string) => value.replace(/\D/g, '');

export const subtotalOf = (items: LineItem[]): Cents => items.reduce((sum, item) => sum + item.price * item.qty, 0);

export function expiryProblem(expiry: string, now = new Date()): string | undefined {
  const digits = digitsOf(expiry);

  if (digits.length < 4) return undefined;

  const month = Number(digits.slice(0, 2));
  const year = 2000 + Number(digits.slice(2, 4));

  if (month < 1 || month > 12) return 'The expiry month must be 01 to 12';

  const firstDayAfterExpiryMonth = new Date(year, month);

  if (firstDayAfterExpiryMonth <= now) return 'The card has expired';

  return undefined;
}

const isCardComplete = (card: Card) =>
  digitsOf(card.number).length === 16 &&
  digitsOf(card.expiry).length === 4 &&
  expiryProblem(card.expiry) === undefined &&
  /^\d{3,4}$/.test(card.cvc);

const cardAfterUpdate = (card: Card, event: CheckoutEvent): Card =>
  event.type === 'UPDATE_CARD' ? { ...card, [event.field]: event.value } : card;

const charge = fromPromise<{ receiptId: string }, { card: Card }>(async ({ input }) => {
  await new Promise((resolve) => setTimeout(resolve, 800));

  if (digitsOf(input.card.number).endsWith('0002')) throw new Error('Card declined');

  return { receiptId: `rcpt_${Math.random().toString(36).slice(2, 8)}` };
});

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
    beforePayment: stateIn('#checkout.payment.idle'),
    hasItems: stateIn('#checkout.cart.filled'),
    removesLastItem: ({ context, event }) =>
      event.type === 'REMOVE_ITEM' && context.items.every((item) => item.id === event.id),
    cardComplete: ({ context, event }) => isCardComplete(cardAfterUpdate(context.card, event)),
  },
}).createMachine({
  id: 'checkout',
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
              actions: assign({
                items: ({ context, event }) =>
                  context.items.map((item) =>
                    item.id === event.id ? { ...item, qty: Math.min(Math.max(event.qty, 1), maxQty) } : item,
                  ),
              }),
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
            complete: { on: { PAY: '#checkout.payment.processing' } },
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
