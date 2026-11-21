'use client';

import { useMachine } from 'shiru/xstate';
import { Cart, EmptyCart, Payment, Receipt } from '@/components/demo/checkout-screens';
import { checkoutMachine } from '@/demo/checkout/xstate/machine';

export function Checkout() {
  const [snapshot, send] = useMachine(checkoutMachine);
  const { items, card, error, receiptId } = snapshot.context;
  const { shipping } = snapshot.value;

  if (snapshot.matches({ payment: 'idle' })) {
    return snapshot.matches({ cart: 'empty' }) ? <EmptyCart send={send} /> : <Cart items={items} shipping={shipping} send={send} />;
  }

  if (snapshot.matches({ payment: 'success' })) return <Receipt items={items} shipping={shipping} receiptId={receiptId} />;

  return (
    <Payment
      items={items}
      shipping={shipping}
      card={card}
      busy={snapshot.hasTag('busy')}
      failed={snapshot.matches({ payment: 'error' })}
      error={error}
      canBack={snapshot.can({ type: 'BACK' })}
      canPay={snapshot.can({ type: 'PAY' })}
      send={send}
    />
  );
}
