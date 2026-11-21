'use client';

import { useMachineReducer } from 'konat/reducer';
import { Cart, EmptyCart, Payment, Receipt } from '@/components/demo/checkout-screens';
import { isCardComplete } from '@/demo/checkout/order';
import { checkoutReducerMachine, initialCheckout } from '@/demo/checkout/reducer/machine';

export function Checkout() {
  const [state, dispatch] = useMachineReducer(checkoutReducerMachine, initialCheckout);
  const { items, shipping, card } = state.order;

  switch (state.step) {
    case 'cart':
      return <Cart items={items} shipping={shipping} send={dispatch} />;
    case 'emptyCart':
      return <EmptyCart send={dispatch} />;
    case 'success':
      return <Receipt items={items} shipping={shipping} receiptId={state.receiptId} />;
    case 'editing':
    case 'processing':
    case 'error':
      return (
        <Payment
          items={items}
          shipping={shipping}
          card={card}
          busy={state.step === 'processing'}
          failed={state.step === 'error'}
          error={state.step === 'error' ? state.error : undefined}
          canBack={state.step !== 'processing'}
          canPay={state.step === 'editing' && isCardComplete(card)}
          send={dispatch}
        />
      );
  }
}
