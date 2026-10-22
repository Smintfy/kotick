'use client';

import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Konat } from 'konat';
import { useMachine } from 'konat/xstate';
import { type CheckoutEvent, checkoutMachine, fixturesInEveryBuild } from '@/demo/checkout';

const shippingOptions = [
  { key: 'standard', label: 'Standard', fee: 0, event: { type: 'SHIP_STANDARD' } },
  { key: 'express', label: 'Express', fee: 1500, event: { type: 'SHIP_EXPRESS' } },
  { key: 'pickup', label: 'Pickup', fee: 0, event: { type: 'SHIP_PICKUP' } },
] as const satisfies ReadonlyArray<{ key: string; label: string; fee: number; event: CheckoutEvent }>;

const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function Checkout() {
  const [snapshot, send] = useMachine(checkoutMachine);
  const { items, total, cardNumber, error, receiptId } = snapshot.context;
  const shipping = shippingOptions.find((option) => snapshot.matches({ shipping: option.key })) ?? shippingOptions[0];
  const grandTotal = formatPrice(total + shipping.fee);

  return (
    <div className="grid gap-4 text-sm">
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

      <fieldset className="min-w-0">
        <legend className="mb-2 font-medium">Shipping</legend>
        <div className="divide-y divide-line rounded-lg border border-chip">
          {shippingOptions.map((option) => (
            <label key={option.key} className="flex cursor-pointer items-center gap-2.5 px-2.5 py-2">
              <input
                type="radio"
                className="m-0"
                name="shipping"
                checked={snapshot.matches({ shipping: option.key })}
                disabled={!snapshot.can(option.event)}
                onChange={() => send(option.event)}
              />
              {option.label}
              <span className="ml-auto text-muted">{option.fee ? formatPrice(option.fee) : 'Free'}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="m-0 flex justify-between gap-4">
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
              className="rounded-lg border border-chip bg-bg px-2.5 py-2 font-mono text-sm leading-[normal] font-normal text-fg"
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
            className="mt-2 cursor-pointer justify-self-start rounded-lg bg-fg px-3.5 py-2 text-sm font-medium text-bg disabled:cursor-default disabled:opacity-45"
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
              className="cursor-pointer rounded-lg bg-fg px-3.5 py-2 text-sm font-medium text-bg"
              onClick={() => send({ type: 'RETRY' })}
            >
              Retry
            </button>
            <button
              type="button"
              className="cursor-pointer rounded-lg bg-selected px-3.5 py-2 text-sm font-medium text-fg"
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
      <figure className="relative mb-6 rounded-2xl border border-line">
        <button
          type="button"
          aria-label="Reset"
          className="absolute top-3 right-3 z-10 grid size-8 cursor-pointer place-items-center rounded-lg text-muted hover:bg-selected hover:text-fg"
          onClick={() => setRun(run + 1)}
        >
          <RotateCcw className="size-4" />
        </button>
        <div className="min-h-[520px] px-6 pt-14 pb-20">
          <div className="mx-auto max-w-[360px]">
            <Checkout key={run} />
          </div>
        </div>
        {/*
         * The host of the overlay is position: fixed.
         * With contain: layout, the dock is the containing block of the host, so the overlay stays in the dock.
         * The dock starts below the Reset button, so the open panel does not cover the button.
         */}
        <div ref={setDock} className="pointer-events-none absolute inset-x-0 top-14 bottom-0 [contain:layout]">
          <p className="absolute right-16 bottom-8 m-0 translate-y-1/2 text-[13px] text-muted">Click the bubble, or press Alt+S.</p>
          {dock && <Konat portalTarget={dock} theme="light" fixtures={fixturesInEveryBuild} />}
        </div>
      </figure>
      <div className="prose">
        <ol>
          <li>
            Click the bubble to open the panel. Select <strong>checkout</strong>, then <strong>error</strong> under{' '}
            <strong>payment</strong>.
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
        <div className="my-6 overflow-x-auto rounded-xl border border-line">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th className="w-20">Mark</th>
                <th>What it is</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Recorded</td>
                <td>
                  <span className="inline-grid size-4 place-items-center rounded-[3px] text-[13px] leading-none font-medium bg-recorded-soft text-recorded">
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
                  <span className="inline-grid size-4 place-items-center rounded-[3px] text-[13px] leading-none font-medium bg-fixture-soft text-fixture">
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
                  <span className="inline-grid size-4 place-items-center rounded-[3px] text-[13px] leading-none font-medium border border-dashed border-chip text-muted">
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
        <p className="border-l-2 border-callout px-4 py-3 text-[13px] text-muted">
          This site builds konat in development mode for the demo. In your production build,{' '}
          <code>&lt;Konat /&gt;</code> renders nothing.
        </p>
      </div>
    </>
  );
}
