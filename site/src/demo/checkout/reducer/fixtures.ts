import { type CompleteFixtures, defineFixtures } from 'shiru/reducer';
import { checkoutReducerMachine, initialCheckout, type Order } from '@/demo/checkout/reducer/machine';

const order: Order = initialCheckout.order;

const withCard: Order = { ...order, card: { number: '4242 4242 4242 4242', expiry: '12/30', cvc: '123' } };

export const checkoutReducerFixtures = defineFixtures(checkoutReducerMachine, {
  cart: { step: 'cart', order },
  emptyCart: { step: 'emptyCart', order: { ...order, items: [] } },
  editing: { step: 'editing', order },
  processing: { step: 'processing', order: withCard },
  error: {
    step: 'error',
    order: { ...withCard, card: { ...withCard.card, number: '4000 0000 0000 0002' } },
    error: 'Card declined',
  },
  success: { step: 'success', order: withCard, receiptId: 'rcpt_123' },
} satisfies CompleteFixtures<typeof checkoutReducerMachine>);
