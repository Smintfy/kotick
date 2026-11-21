import { defineFixtures } from 'konat/xstate';
import { emptyCard, startItems } from '@/demo/checkout/order';
import { type CheckoutContext, checkoutMachine } from '@/demo/checkout/xstate/machine';

const base: CheckoutContext = { items: startItems, card: emptyCard };

const withCard: CheckoutContext = { ...base, card: { number: '4242 4242 4242 4242', expiry: '12/30', cvc: '123' } };

export const fixturesInEveryBuild = [
  defineFixtures(checkoutMachine, {
    'cart.filled': { context: base },
    'cart.empty': { context: { ...base, items: [] } },
    'shipping.standard': { context: base },
    'shipping.express': { context: base },
    'shipping.pickup': { context: base },
    'payment.idle': { context: base },
    'payment.editing.incomplete': { context: base },
    'payment.editing.complete': { context: withCard },
    'payment.processing': { context: withCard },
    'payment.error': {
      context: { ...withCard, card: { ...withCard.card, number: '4000 0000 0000 0002' }, error: 'Card declined' },
    },
    'payment.success': { context: { ...withCard, receiptId: 'rcpt_123' } },
  }),
];
