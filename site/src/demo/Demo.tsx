'use client';

import Link from 'next/link';
import { useState } from 'react';
import { StateViewer } from 'state-viewer';
import { useMachine } from 'state-viewer/xstate';
import { type CheckoutEvent, checkoutMachine, fixturesInEveryBuild } from '@/demo/checkout';

const shippingOptions = [
  { key: 'standard', label: 'Standard', fee: 0, event: { type: 'SHIP_STANDARD' } },
  { key: 'express', label: 'Express', fee: 1500, event: { type: 'SHIP_EXPRESS' } },
  { key: 'pickup', label: 'Pickup', fee: 0, event: { type: 'SHIP_PICKUP' } },
] as const satisfies ReadonlyArray<{ key: string; label: string; fee: number; event: CheckoutEvent }>;

const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const reloadWithDeepLink = '/?debug-state=checkout:payment.error;shipping.express#how-it-works';

function Checkout() {
  const [snapshot, send] = useMachine(checkoutMachine);
  const { items, total, cardNumber, error, receiptId } = snapshot.context;
  const shipping = shippingOptions.find((option) => snapshot.matches({ shipping: option.key })) ?? shippingOptions[0];
  const grandTotal = formatPrice(total + shipping.fee);

  return (
    <div className="checkout">
      <ul className="checkout-lines">
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
          <label key={option.key}>
            <input
              type="radio"
              name="shipping"
              checked={snapshot.matches({ shipping: option.key })}
              disabled={!snapshot.can(option.event)}
              onChange={() => send(option.event)}
            />
            {option.label}
            <span>{option.fee ? formatPrice(option.fee) : 'Free'}</span>
          </label>
        ))}
      </fieldset>

      <p className="checkout-total">
        <span>Total</span>
        <strong>{grandTotal}</strong>
      </p>

      {snapshot.matches({ payment: 'editing' }) && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            send({ type: 'PAY' });
          }}
        >
          <label>
            Card number
            <input
              value={cardNumber}
              inputMode="numeric"
              autoComplete="off"
              placeholder="4242 4242 4242 4242"
              onChange={(event) => send({ type: 'UPDATE_CARD', cardNumber: event.target.value })}
            />
          </label>
          <p className="checkout-hint">Any 16 digits pay. Cards that end in 0002 are declined.</p>
          <button type="submit" disabled={!snapshot.can({ type: 'PAY' })}>
            Pay {grandTotal}
          </button>
        </form>
      )}

      {snapshot.hasTag('busy') && <p role="status">Processing payment…</p>}

      {snapshot.matches({ payment: 'error' }) && (
        <div role="alert" className="checkout-notice" data-tone="error">
          <p>{error ?? 'Payment failed'}</p>
          <div className="checkout-actions">
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
        <p role="status" className="checkout-notice" data-tone="success">
          Paid. Receipt <code>{receiptId}</code>
        </p>
      )}
    </div>
  );
}

export function Demo({ fixturesHref }: { fixturesHref: string }) {
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const [run, setRun] = useState(0);

  return (
    <>
      <p>
        A checkout page with the real overlay docked beside it. The panel lists the checkout machine and all of its
        states, also the states that the page has not gone to.
      </p>
      <figure className="demo">
        <div className="demo-bar">
          <span>checkout</span>
          <button type="button" onClick={() => setRun(run + 1)}>
            Reset
          </button>
        </div>
        <div className="demo-body">
          <div className="demo-app">
            <Checkout key={run} />
          </div>
          <div ref={setDock} className="demo-dock">
            <p className="demo-hint">Click the bubble, or press Alt+S.</p>
            {dock && <StateViewer portalTarget={dock} defaultOpen fixtures={fixturesInEveryBuild} />}
          </div>
        </div>
      </figure>
      <div className="prose">
        <ol>
          <li>
            In the panel, select <strong>checkout</strong>, then <strong>error</strong> under <strong>payment</strong>.
            The checkout shows Card declined. You did not have to type a declined card and pay to get there.
          </li>
          <li>
            Click <strong>Retry</strong>. The machine does not get the event. Scroll down the panel to{' '}
            <strong>Blocked events</strong>. It lists RETRY.
          </li>
          <li>
            Select <strong>error</strong> again to release the preview. The checkout shows the real state again.
          </li>
        </ol>
        <p>A preview needs context. The marks before each leaf in the panel show where it comes from:</p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Mark</th>
                <th>What it is</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Recorded</td>
                <td>
                  <span className="source-mark" data-source="recorded">
                    R
                  </span>
                </td>
                <td>
                  The last context that the real actor had in this state. It stays in <code>sessionStorage</code>, so it
                  is still there after a reload.
                </td>
              </tr>
              <tr>
                <td>Fixture</td>
                <td>
                  <span className="source-mark" data-source="fixture">
                    F
                  </span>
                </td>
                <td>
                  Context that you wrote with <code>defineFixtures()</code>.
                </td>
              </tr>
              <tr>
                <td>None</td>
                <td>
                  <span className="source-mark" data-source="none">
                    –
                  </span>
                </td>
                <td>
                  The preview uses the live context of the real actor, and logs a warning, because the live context often
                  does not agree with the state.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          This demo has a <Link href={fixturesHref}>fixture</Link> for each state, so no preview uses the live context.
        </p>
        <p>
          <strong>Copy link</strong> in the panel writes a URL that opens the page with the same previews.{' '}
          <a href={reloadWithDeepLink}>
            Open this page with payment.error and shipping.express
          </a>
          .
        </p>
        <p className="demo-caption">
          This site builds state-viewer in development mode for the demo. In your production build,{' '}
          <code>&lt;StateViewer /&gt;</code> renders nothing.
        </p>
      </div>
    </>
  );
}
