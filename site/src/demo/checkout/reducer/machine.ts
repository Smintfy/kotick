import { defineReducerMachine } from 'konat/reducer';
import {
  type Card,
  type CheckoutEvent,
  chargeCard,
  emptyCard,
  isCardComplete,
  type LineItem,
  type Shipping,
  startItems,
  withQty,
} from '@/demo/checkout/order';

export type Order = { items: LineItem[]; shipping: Shipping; card: Card };

export type CheckoutState =
  | { step: 'cart'; order: Order }
  | { step: 'emptyCart'; order: Order }
  | { step: 'editing'; order: Order }
  | { step: 'processing'; order: Order }
  | { step: 'error'; order: Order; error: string }
  | { step: 'success'; order: Order; receiptId: string };

/** The effect of processing sends the result of the request as one of these events. */
type ChargeEvent = { type: 'CHARGED'; receiptId: string } | { type: 'DECLINED'; error: string };

export const initialCheckout: CheckoutState = { step: 'cart', order: { items: startItems, shipping: 'standard', card: emptyCard } };

const ship = (order: Order, shipping: Shipping): CheckoutState => ({ step: 'cart', order: { ...order, shipping } });

export const checkoutReducerMachine = defineReducerMachine<CheckoutState, CheckoutEvent | ChargeEvent>()({
  id: 'checkout-reducer',
  discriminant: 'step',
  states: {
    cart: {
      on: {
        SET_QTY: (state, event) => ({
          step: 'cart',
          order: { ...state.order, items: withQty(state.order.items, event.id, event.qty) },
        }),
        REMOVE_ITEM: (state, event) => {
          const items = state.order.items.filter((item) => item.id !== event.id);

          return { step: items.length > 0 ? 'cart' : 'emptyCart', order: { ...state.order, items } };
        },
        SHIP_STANDARD: (state) => ship(state.order, 'standard'),
        SHIP_EXPRESS: (state) => ship(state.order, 'express'),
        SHIP_PICKUP: (state) => ship(state.order, 'pickup'),
        CONTINUE: (state) => ({ step: 'editing', order: state.order }),
      },
    },
    emptyCart: {
      on: { RESTORE_ITEMS: (state) => ({ step: 'cart', order: { ...state.order, items: startItems } }) },
    },
    editing: {
      on: {
        UPDATE_CARD: (state, event) => ({
          step: 'editing',
          order: { ...state.order, card: { ...state.order.card, [event.field]: event.value } },
        }),
        PAY: (state) => (isCardComplete(state.order.card) ? { step: 'processing', order: state.order } : state),
        BACK: (state) => ({ step: 'cart', order: state.order }),
      },
    },
    processing: {
      on: {
        CHARGED: (state, event) => ({ step: 'success', order: state.order, receiptId: event.receiptId }),
        DECLINED: (state, event) => ({ step: 'error', order: state.order, error: event.error }),
      },
      // The request runs in the machine, so a preview never blocks its result.
      effect: (state, send) => {
        void chargeCard(state.order.card).then(
          ({ receiptId }) => send({ type: 'CHARGED', receiptId }),
          (error: Error) => send({ type: 'DECLINED', error: error.message }),
        );
      },
    },
    error: {
      on: {
        RETRY: (state) => ({ step: 'processing', order: state.order }),
        EDIT_CARD: (state) => ({ step: 'editing', order: state.order }),
        BACK: (state) => ({ step: 'cart', order: state.order }),
      },
    },
    success: {},
  },
});
