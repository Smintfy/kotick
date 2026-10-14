// Hand-written context for states the demo is slow or awkward to reach. Loaded lazily by <StateViewer fixtures>, and
// only in development (App.tsx), so production builds don't include it.
//
// The uploads have none on purpose: each row's context comes from its own input, which a fixture would replace, so
// their states show the "no data" marker until they've been visited, and previews of them use live context.

import { defineFixtures } from 'state-viewer/xstate';
import { cartMachine } from '../cart/machine.ts';
import { checkoutMachine } from '../checkout/machine.ts';
import { products } from '../products.ts';
import { sessionMachine } from '../session/machine.ts';

const items = [
  { ...products[0], qty: 2 },
  { ...products[1], qty: 1 },
];
const checkout = { items, total: 6600, cardNumber: '4242 4242 4242 4242' };

export default [
  defineFixtures(checkoutMachine, {
    'payment.editing.complete': { context: checkout },
    'payment.processing': { context: checkout },
    'payment.error': { context: { ...checkout, cardNumber: '4000 0000 0000 0002', error: 'Card declined' } },
    'payment.success': { context: { ...checkout, receiptId: 'rcpt_fixture' } },
  }),
  defineFixtures(cartMachine, {
    filled: { context: { items } },
  }),
  defineFixtures(sessionMachine, {
    signedOut: { context: { user: null } },
    signingIn: { context: { user: null } },
  }),
];
