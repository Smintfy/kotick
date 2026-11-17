'use client';

import { ArrowLeft, Check, type LucideIcon, Minus, Plus, ShoppingBag, Store, Trash2, Truck, Zap } from 'lucide-react';
import Link from 'next/link';
import type { ChangeEvent } from 'react';
import { useMachine } from 'konat/xstate';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  type Card,
  type CheckoutEvent,
  checkoutMachine,
  expiryProblem,
  fixturesInEveryBuild,
  maxQty,
  subtotalOf,
} from '@/demo/checkout';
import { DemoWindow } from '@/demo/demo-window';

const shippingOptions = [
  { key: 'standard', label: 'Standard', fee: 0, Icon: Truck, event: { type: 'SHIP_STANDARD' } },
  { key: 'express', label: 'Express', fee: 1500, Icon: Zap, event: { type: 'SHIP_EXPRESS' } },
  { key: 'pickup', label: 'Pickup', fee: 0, Icon: Store, event: { type: 'SHIP_PICKUP' } },
] as const satisfies ReadonlyArray<{ key: string; label: string; fee: number; Icon: LucideIcon; event: CheckoutEvent }>;

const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const feeOf = (option: { fee: number }) => (option.fee ? formatPrice(option.fee) : 'Free');

const digitsOf = (value: string) => value.replace(/\D/g, '');

/** Each formatter keeps only the digits that the field accepts, and adds the separators. */
const cardFormats: Record<keyof Card, (value: string) => string> = {
  number: (value) =>
    digitsOf(value)
      .slice(0, 16)
      .replace(/(\d{4})(?=\d)/g, '$1 '),
  expiry: (value) => {
    const digits = digitsOf(value).slice(0, 4);

    return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
  },
  cvc: (value) => digitsOf(value).slice(0, 4),
};

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 tabular-nums">{value}</dd>
    </div>
  );
}

export function Checkout() {
  const [snapshot, send] = useMachine(checkoutMachine);
  const { items, card, error, receiptId } = snapshot.context;
  const shipping = shippingOptions.find((option) => snapshot.matches({ shipping: option.key })) ?? shippingOptions[0];
  const subtotal = subtotalOf(items);
  const count = items.reduce((sum, item) => sum + item.qty, 0);
  const grandTotal = formatPrice(subtotal + shipping.fee);
  const busy = snapshot.hasTag('busy');
  const failed = snapshot.matches({ payment: 'error' });
  const editing = snapshot.matches({ payment: 'editing' });
  const expiryError = expiryProblem(card.expiry);
  const hintIsError = failed || expiryError !== undefined;

  /** On the payment step, the cart is not on the page, so the breakdown lists the items too. */
  const summary = (withItems: boolean) => (
    <Accordion className="border-t pt-2">
      <AccordionItem>
        <AccordionTrigger className="items-center gap-2 font-normal hover:no-underline">
          <span className="flex flex-1 justify-between gap-4">
            <span>Total</span>
            <span className="font-medium text-heading tabular-nums">{grandTotal}</span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="pr-6">
          <dl className="m-0 grid gap-1.5">
            {withItems &&
              items.map((item) => (
                <SummaryRow key={item.id} label={`${item.name} × ${item.qty}`} value={formatPrice(item.price * item.qty)} />
              ))}
            <SummaryRow label={`Subtotal (${count} ${count === 1 ? 'item' : 'items'})`} value={formatPrice(subtotal)} />
            <SummaryRow label={`Shipping (${shipping.label})`} value={feeOf(shipping)} />
          </dl>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );

  const cardInput = (field: keyof Card) => ({
    value: card[field],
    inputMode: 'numeric' as const,
    autoComplete: 'off',
    disabled: !editing,
    'aria-describedby': 'card-hint',
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      send({ type: 'UPDATE_CARD', field, value: cardFormats[field](event.target.value) }),
  });

  if (snapshot.matches({ payment: 'success' })) {
    return (
      <div role="status" className="grid gap-6 text-sm">
        <span className="grid size-11 place-items-center rounded-full bg-selected text-heading">
          <Check className="size-5" />
        </span>
        <div className="grid gap-1">
          <h3 className="m-0">Payment complete</h3>
          <p className="m-0 text-muted-foreground">
            Your receipt is <code>{receiptId}</code>.
          </p>
        </div>
        <ul className="grid gap-1">
          {items.map((item) => (
            <li key={item.id} className="flex justify-between gap-4">
              <span>
                {item.name} × {item.qty}
              </span>
              <span className="tabular-nums">{formatPrice(item.price * item.qty)}</span>
            </li>
          ))}
        </ul>
        {summary(false)}
      </div>
    );
  }

  if (snapshot.matches({ payment: 'idle' })) {
    const header = (
      <div className="grid gap-1">
        <h3 className="m-0">Checkout</h3>
        <p className="m-0 text-muted-foreground">Check the cart, then select the shipping.</p>
      </div>
    );

    if (snapshot.matches({ cart: 'empty' })) {
      return (
        <div className="grid gap-6 text-sm">
          {header}
          <div className="grid justify-items-center gap-3 rounded-lg border border-dashed border-input px-4 py-10 text-center">
            <ShoppingBag className="size-5 text-muted-foreground" />
            <p className="m-0 text-muted-foreground">Your cart is empty.</p>
            <Button variant="outline" onClick={() => send({ type: 'RESTORE_ITEMS' })}>
              Add the items again
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="grid gap-6 text-sm">
        {header}

        <ul aria-label="Cart" className="grid gap-3">
          {items.map((item) => {
            const less: CheckoutEvent =
              item.qty > 1 ? { type: 'SET_QTY', id: item.id, qty: item.qty - 1 } : { type: 'REMOVE_ITEM', id: item.id };
            const more: CheckoutEvent = { type: 'SET_QTY', id: item.id, qty: item.qty + 1 };

            return (
              <li key={item.id} className="flex items-center gap-3">
                <div className="grid min-w-0 flex-1">
                  <span className="truncate text-heading">{item.name}</span>
                  <span className="text-[13px] text-muted-foreground">{formatPrice(item.price)} each</span>
                </div>
                <div role="group" aria-label={`Quantity of ${item.name}`} className="flex items-center rounded-lg border border-input">
                  {/* At a quantity of 1, the minus button removes the item. */}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={item.qty > 1 ? `Remove one ${item.name}` : `Remove ${item.name} from the cart`}
                    title={item.qty > 1 ? 'Remove one' : 'Remove from the cart'}
                    disabled={!snapshot.can(less)}
                    onClick={() => send(less)}
                  >
                    {item.qty > 1 ? <Minus /> : <Trash2 />}
                  </Button>
                  <output aria-live="polite" className="w-6 text-center tabular-nums">
                    {item.qty}
                  </output>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Add one ${item.name}`}
                    title="Add one"
                    disabled={item.qty >= maxQty || !snapshot.can(more)}
                    onClick={() => send(more)}
                  >
                    <Plus />
                  </Button>
                </div>
                <span className="w-16 text-right tabular-nums">{formatPrice(item.price * item.qty)}</span>
              </li>
            );
          })}
        </ul>

        <fieldset className="min-w-0">
          <legend className="mb-2 font-medium">Shipping</legend>
          <RadioGroup
            value={shipping.key}
            onValueChange={(key) => {
              const option = shippingOptions.find((candidate) => candidate.key === key);

              if (option) send(option.event);
            }}
          >
            {shippingOptions.map((option) => (
              <Label
                key={option.key}
                className="relative h-9 cursor-pointer gap-2.5 rounded-lg border border-input px-2.5 leading-normal font-normal transition-colors hover:bg-surface has-focus-visible:ring-3 has-focus-visible:ring-ring/50 has-data-checked:border-fg has-data-checked:font-medium has-data-checked:text-heading has-data-disabled:pointer-events-none has-data-disabled:opacity-50"
              >
                <option.Icon className="size-4 shrink-0 text-muted-foreground" />
                {option.label}
                <span className="ml-auto font-normal text-muted-foreground">{feeOf(option)}</span>
                {/* The card shows the selection and the focus. The radio stays for the keyboard and for screen readers. */}
                <RadioGroupItem value={option.key} className="absolute opacity-0" disabled={!snapshot.can(option.event)} />
              </Label>
            ))}
          </RadioGroup>
        </fieldset>

        <div className="grid gap-4">
          {summary(false)}
          <Button size="lg" className="w-full" disabled={!snapshot.can({ type: 'CONTINUE' })} onClick={() => send({ type: 'CONTINUE' })}>
            Continue to payment
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="grid gap-6 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        send({ type: 'PAY' });
      }}
    >
      <div className="grid justify-items-start gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground"
          disabled={!snapshot.can({ type: 'BACK' })}
          onClick={() => send({ type: 'BACK' })}
        >
          <ArrowLeft />
          Cart
        </Button>
        <div className="grid gap-1">
          <h3 className="m-0">Payment</h3>
          <p className="m-0 text-muted-foreground">Enter the card details.</p>
        </div>
      </div>

      <div className="grid gap-3">
        <div className="grid gap-2">
          <Label htmlFor="card-number">Card number</Label>
          <Input
            id="card-number"
            className="h-9 font-mono"
            placeholder="4242 4242 4242 4242"
            aria-invalid={failed || undefined}
            {...cardInput('number')}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label htmlFor="card-expiry">Expiry date</Label>
            <Input
              id="card-expiry"
              className="h-9 font-mono"
              placeholder="MM/YY"
              aria-invalid={expiryError !== undefined || undefined}
              {...cardInput('expiry')}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="card-cvc">CVC</Label>
            <Input id="card-cvc" className="h-9 font-mono" placeholder="123" {...cardInput('cvc')} />
          </div>
        </div>
        <p
          id="card-hint"
          role={hintIsError ? 'alert' : undefined}
          className={`m-0 text-[13px] ${hintIsError ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {failed
            ? `${error ?? 'Payment failed'}.`
            : expiryError
              ? `${expiryError}.`
              : 'Any card number with a future date pays. Cards that end in 0002 are declined.'}
        </p>
      </div>

      <div className="grid gap-4">
        {summary(true)}
        {failed ? (
          <div className="grid gap-1">
            <Button type="button" size="lg" className="w-full" onClick={() => send({ type: 'RETRY' })}>
              Retry
            </Button>
            <Button type="button" variant="ghost" size="lg" className="justify-self-center" onClick={() => send({ type: 'EDIT_CARD' })}>
              Edit card
            </Button>
          </div>
        ) : (
          <Button type="submit" size="lg" className="w-full" disabled={!snapshot.can({ type: 'PAY' })}>
            {busy ? 'Processing…' : `Pay ${grandTotal}`}
          </Button>
        )}
      </div>
    </form>
  );
}

export function Demo({ fixturesHref, pageHref }: { fixturesHref: string; pageHref: string }) {
  return (
    <>
      <p>
        A checkout page with the real overlay docked beside it. The panel lists the checkout machine and all of its
        states, also the states that the page has not gone to.
      </p>
      <DemoWindow fixtures={fixturesInEveryBuild} href={pageHref}>
        <Checkout />
      </DemoWindow>
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
        <p>A preview needs context. The marks after each leaf in the panel show where it comes from:</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Source</TableHead>
              <TableHead className="w-24">Mark</TableHead>
              <TableHead>What it is</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Recorded</TableCell>
              <TableCell>
                <span className="inline-grid size-4 place-items-center rounded-[3px] text-[13px] leading-none font-medium bg-recorded-soft text-recorded">
                  R
                </span>
              </TableCell>
              <TableCell>
                The last context that the real actor had in this state. It stays in <code>sessionStorage</code>, so it
                is still there after a reload.
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Fixture</TableCell>
              <TableCell>
                <span className="inline-grid size-4 place-items-center rounded-[3px] text-[13px] leading-none font-medium bg-fixture-soft text-fixture">
                  F
                </span>
              </TableCell>
              <TableCell>
                Context that you wrote with <code>defineFixtures()</code>.
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>None</TableCell>
              <TableCell>
                <span className="inline-grid size-4 place-items-center rounded-[3px] text-[13px] leading-none font-medium border border-dashed border-chip text-muted-foreground">
                  –
                </span>
              </TableCell>
              <TableCell>
                The preview uses the live context of the real actor, and logs a warning, because the live context often
                does not agree with the state.
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p>
          This demo has a <Link href={fixturesHref}>fixture</Link> for each state, so no preview uses the live context.
        </p>
        <p className="border-l-2 border-callout px-4 py-3 text-[13px] text-muted-foreground">
          This site builds konat in development mode for the demo. In your production build,{' '}
          <code>&lt;Konat /&gt;</code> renders nothing.
        </p>
      </div>
    </>
  );
}
