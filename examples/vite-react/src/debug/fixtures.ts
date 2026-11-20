// Context for states that are slow or hard to get to in the example app.
// <Konat fixtures> loads this file only when necessary, and only in development (Layout.tsx).
// Thus, production builds do not include it.
//
// We did not write fixtures for the upload machine.
// The context of each row comes from the input of the row, and a fixture will replace that input.
// Thus, a state of a row shows "no data" until the row goes to that state.
// Previews of that state use the live context.
//
// The search machine is a reducer machine, and each of its fixtures is a whole state object.
// Both entries export defineFixtures, so this file imports the one of konat/reducer with another name.

import { defineFixtures as defineReducerFixtures, type CompleteFixtures } from 'konat/reducer';
import { defineFixtures } from 'konat/xstate';
import { products } from '@/lib/products.ts';
import { cartMachine } from '@/machines/cart.ts';
import { checkoutMachine } from '@/machines/checkout.ts';
import { searchMachine } from '@/machines/search.ts';
import { sessionMachine } from '@/machines/session.ts';

const items = [
  { ...products[0], qty: 2 },
  { ...products[1], qty: 1 },
];

const checkout = { items, subtotalCents: 6600, cardNumber: '4242 4242 4242 4242' };

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
  // satisfies CompleteFixtures makes this file fail when the machine gets a state that has no fixture.
  defineReducerFixtures(searchMachine, {
    idle: { status: 'idle' },
    loading: { status: 'loading', query: 'mug' },
    ready: { status: 'ready', query: 'mug', hits: [products[1]] },
    failed: { status: 'failed', query: 'mug', error: 'Connection lost' },
  } satisfies CompleteFixtures<typeof searchMachine>),
];
