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
    <div className="grid gap-4 text-[14px]">
      <ul>
        {items.map((item) => (
          <li key={item.id} className="flex justify-between gap-4">
            <span>
              {item.name} × {item.qty}
            </span>
            <span>{formatPrice(item.price * item.qty)}</span>
          </li>
        ))}
      </ul>

      <fieldset className="grid min-w-0 gap-1">
        <legend className="mb-1.5 font-medium">Shipping</legend>
        {shippingOptions.map((option) => (
          <label key={option.key} className="flex items-center gap-2">
            <input
              type="radio"
              className="mt-[3px] mr-[3px] ml-[5px]"
              name="shipping"
              checked={snapshot.matches({ shipping: option.key })}
              disabled={!snapshot.can(option.event)}
              onChange={() => send(option.event)}
            />
            {option.label}
            <span className="ml-auto text-muted">{option.fee ? formatPrice(option.fee) : 'Free'}</span>
          </label>
        ))}
      </fieldset>

      <p className="m-0 flex justify-between gap-4 border-t border-line pt-3">
        <span>Total</span>
        <strong>{grandTotal}</strong>
      </p>

      {snapshot.matches({ payment: 'editing' }) && (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            send({ type: 'PAY' });
          }}
        >
          <label className="grid gap-2 font-medium">
            Card number
            <input
              className="rounded-lg border border-chip bg-bg px-2.5 py-2 font-mono text-[14px] leading-[normal] font-normal text-fg"
              value={cardNumber}
              inputMode="numeric"
              autoComplete="off"
              placeholder="4242 4242 4242 4242"
              onChange={(event) => send({ type: 'UPDATE_CARD', cardNumber: event.target.value })}
            />
          </label>
          <p className="m-0 text-[13px] text-muted">Any 16 digits pay. Cards that end in 0002 are declined.</p>
          <button
            type="submit"
            className="cursor-pointer justify-self-start rounded-lg bg-fg px-3.5 py-2 text-[14px] font-medium text-bg disabled:cursor-default disabled:opacity-45"
            disabled={!snapshot.can({ type: 'PAY' })}
          >
            Pay {grandTotal}
          </button>
        </form>
      )}

      {snapshot.hasTag('busy') && <p role="status" className="m-0">
          Processing payment…
        </p>}

      {snapshot.matches({ payment: 'error' }) && (
        <div role="alert" className="grid gap-2.5 rounded-lg bg-surface px-3.5 py-3 shadow-[inset_3px_0_var(--color-badge)]">
          <p className="m-0">{error ?? 'Payment failed'}</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="cursor-pointer rounded-lg bg-fg px-3.5 py-2 text-[14px] font-medium text-bg"
              onClick={() => send({ type: 'RETRY' })}
            >
              Retry
            </button>
            <button
              type="button"
              className="cursor-pointer rounded-lg bg-selected px-3.5 py-2 text-[14px] font-medium text-fg"
              onClick={() => send({ type: 'EDIT_CARD' })}
            >
              Edit card
            </button>
          </div>
        </div>
      )}

      {snapshot.matches({ payment: 'success' }) && (
        <p role="status" className="m-0 grid gap-2.5 rounded-lg bg-surface px-3.5 py-3 shadow-[inset_3px_0_var(--color-live)]">
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
      <figure className="mb-6 rounded-xl bg-surface">
        <div className="flex items-center justify-between py-2 pr-2 pl-4 font-mono text-[13px] leading-[normal] text-muted-on-surface">
          <span>checkout</span>
          <button type="button" className="cursor-pointer rounded-md bg-bg px-2.5 py-1.5 text-[12px] leading-none font-medium hover:bg-selected" onClick={() => setRun(run + 1)}>
            Reset
          </button>
        </div>
        <div className="grid h-[480px] grid-cols-[minmax(0,1fr)_312px] pb-2 pl-2 @max-[600px]:h-auto @max-[600px]:grid-cols-[minmax(0,1fr)] @max-[600px]:grid-rows-[440px_440px] @max-[600px]:px-2 @max-[600px]:pb-0">
          <div className="overflow-auto rounded-lg bg-bg p-5">
            <Checkout key={run} />
          </div>
          {/*
           * The host of the overlay is position: fixed.
           * With contain: layout, the dock is the containing block of the host, so the overlay stays in the dock.
           */}
          <div ref={setDock} className="relative [contain:layout]">
            <p className="absolute right-4 bottom-[58px] m-0 text-[13px] text-muted-on-surface">Click the bubble, or press Alt+S.</p>
            {dock && <StateViewer portalTarget={dock} defaultOpen theme="light" fixtures={fixturesInEveryBuild} />}
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
        <div className="mb-4 overflow-x-auto">
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
                  <span className="inline-grid size-4 place-items-center rounded-[3px] text-[10px] leading-none font-medium bg-recorded-soft text-recorded">
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
                  <span className="inline-grid size-4 place-items-center rounded-[3px] text-[10px] leading-none font-medium bg-fixture-soft text-fixture">
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
                  <span className="inline-grid size-4 place-items-center rounded-[3px] text-[10px] leading-none font-medium border border-dashed border-chip text-muted">
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
        <p className="text-[13px] text-muted">
          This site builds state-viewer in development mode for the demo. In your production build,{' '}
          <code>&lt;StateViewer /&gt;</code> renders nothing.
        </p>
      </div>
    </>
  );
}
