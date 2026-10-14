import { useMachine } from 'state-viewer/xstate';
import { formatPrice } from '../format.ts';
import { useRenderStats } from '../renderStats.ts';
import { checkoutMachine, type CheckoutEvent } from './machine.ts';

const shippingOptions = [
  { key: 'standard', label: 'Standard', fee: 0, event: { type: 'SHIP_STANDARD' } },
  { key: 'express', label: 'Express', fee: 1500, event: { type: 'SHIP_EXPRESS' } },
  { key: 'pickup', label: 'Pickup', fee: 0, event: { type: 'SHIP_PICKUP' } },
] as const satisfies ReadonlyArray<{ key: string; label: string; fee: number; event: CheckoutEvent }>;

export function Checkout() {
  const [snapshot, send] = useMachine(checkoutMachine);
  const stats = useRenderStats('checkout');

  const { items, total, cardNumber, error, receiptId } = snapshot.context;
  const shipping = shippingOptions.find((option) => snapshot.matches({ shipping: option.key })) ?? shippingOptions[0];
  const grandTotal = formatPrice(total + shipping.fee);

  return (
    <section className="card" aria-labelledby="checkout-title">
      <header className="card-header">
        <div>
          <h2 id="checkout-title">Checkout</h2>
          <p className="pattern">
            <code>useMachine</code> · nested and parallel states
          </p>
        </div>
        <small ref={stats} className="stats" />
      </header>

      <ul className="lines">
        {items.map((item) => (
          <li key={item.id}>
            <span>
              {item.name} × {item.qty}
            </span>
            <span>{formatPrice(item.price * item.qty)}</span>
          </li>
        ))}
      </ul>

      <fieldset>
        <legend>Shipping</legend>
        {shippingOptions.map((option) => (
          <label key={option.key} className="option">
            <input
              type="radio"
              name="shipping"
              checked={snapshot.matches({ shipping: option.key })}
              disabled={!snapshot.can(option.event)}
              onChange={() => send(option.event)}
            />
            {option.label}
            <span className="muted">{option.fee ? formatPrice(option.fee) : 'Free'}</span>
          </label>
        ))}
      </fieldset>

      <p className="total">
        <span>Total</span>
        <strong data-testid="checkout-total">{grandTotal}</strong>
      </p>

      {snapshot.matches({ payment: 'editing' }) && (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            send({ type: 'PAY' });
          }}
        >
          <label className="field">
            Card number
            <input
              value={cardNumber}
              inputMode="numeric"
              autoComplete="off"
              placeholder="4242 4242 4242 4242"
              onChange={(event) => send({ type: 'UPDATE_CARD', cardNumber: event.target.value })}
            />
          </label>
          <p className="muted">Any 16 digits pay. Cards ending in 0002 are declined.</p>
          <button type="submit" disabled={!snapshot.can({ type: 'PAY' })}>
            Pay {grandTotal}
          </button>
        </form>
      )}

      {snapshot.hasTag('busy') && <p role="status">Processing payment…</p>}

      {snapshot.matches({ payment: 'error' }) && (
        <div role="alert" className="notice notice-error">
          <p>{error ?? 'Payment failed'}</p>
          <div className="actions">
            <button type="button" onClick={() => send({ type: 'RETRY' })}>
              Retry
            </button>
            <button type="button" onClick={() => send({ type: 'EDIT_CARD' })}>
              Edit card
            </button>
          </div>
        </div>
      )}

      {snapshot.matches({ payment: 'success' }) && (
        <p role="status" className="notice notice-success">
          Paid. Receipt <code>{receiptId}</code>
        </p>
      )}
    </section>
  );
}
