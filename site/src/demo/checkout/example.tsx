'use client';

import { ArrowLeft, Check, type LucideIcon, Minus, Plus, ShoppingBag, Store, Trash2, Truck, Zap } from 'lucide-react';
import Link from 'next/link';
import type { ChangeEvent } from 'react';
import { useMachineReducer } from 'konat/reducer';
import { useMachine } from 'konat/xstate';
import type { SnapshotFrom } from 'xstate';
import { useAdapter } from '@/components/docs/adapter-tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup } from '@/components/ui/radio-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  type Card,
  type CheckoutEvent,
  digitsOf,
  expiryProblem,
  type LineItem,
  maxQty,
  type Shipping,
  subtotalOf,
} from '@/demo/checkout/order';
import {
  type CheckoutState,
  checkoutReducerFixtures,
  checkoutReducerMachine,
  initialCheckout,
} from '@/demo/checkout/reducer-machine';
import { checkoutMachine, fixturesInEveryBuild } from '@/demo/checkout/xstate-machine';
import { DemoWindow } from '@/demo/demo-window';
import { RadioCard } from '@/demo/radio-card';
import type { DemoSources } from '@/demo/source';

const shippingOptions = [
  { key: 'standard', label: 'Standard', fee: 0, Icon: Truck, event: { type: 'SHIP_STANDARD' } },
  { key: 'express', label: 'Express', fee: 1500, Icon: Zap, event: { type: 'SHIP_EXPRESS' } },
  { key: 'pickup', label: 'Pickup', fee: 0, Icon: Store, event: { type: 'SHIP_PICKUP' } },
] as const satisfies ReadonlyArray<{ key: string; label: string; fee: number; Icon: LucideIcon; event: CheckoutEvent }>;

const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const feeOf = (option: { fee: number }) => (option.fee ? formatPrice(option.fee) : 'Free');

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

/** What the checkout shows. Each adapter makes it from the state of its machine. */
type CheckoutView = {
  step: CheckoutState['step'];
  items: LineItem[];
  shipping: Shipping;
  card: Card;
  error?: string;
  receiptId?: string;
  can(event: CheckoutEvent): boolean;
};

type CheckoutProps = { view: CheckoutView; send: (event: CheckoutEvent) => void };

function CheckoutScreen({ view, send }: CheckoutProps) {
  const { step, items, card, error, receiptId } = view;
  const shipping = shippingOptions.find((option) => option.key === view.shipping) ?? shippingOptions[0];
  const subtotal = subtotalOf(items);
  const count = items.reduce((sum, item) => sum + item.qty, 0);
  const grandTotal = formatPrice(subtotal + shipping.fee);
  const busy = step === 'processing';
  const failed = step === 'error';
  const editing = step === 'editing';
  const expiryError = expiryProblem(card.expiry);
  const cardError = failed ? `${error ?? 'Payment failed'}.` : expiryError ? `${expiryError}.` : undefined;

  const summary = (withItems: boolean) => (
    <Accordion className="border-t pt-2">
      <AccordionItem>
        <AccordionTrigger className="items-center gap-2 hover:no-underline">
          <span className="flex flex-1 justify-between gap-4">
            <span>Total</span>
            <span className="text-foreground tabular-nums">{grandTotal}</span>
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
    'aria-describedby': cardError ? 'card-error' : undefined,
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      send({ type: 'UPDATE_CARD', field, value: cardFormats[field](event.target.value) }),
  });

  if (step === 'success') {
    return (
      <div role="status" className="grid gap-6 text-sm font-medium">
        <span className="grid size-11 place-items-center rounded-full bg-accent text-foreground">
          <Check className="size-5" />
        </span>
        <div className="grid gap-1">
          <h3 className="m-0 font-semibold">Payment complete</h3>
          <p className="m-0 font-normal text-muted-foreground">
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

  if (step === 'cart' || step === 'emptyCart') {
    const header = (
      <div className="grid gap-1">
        <h3 className="m-0 font-semibold">Checkout</h3>
        <p className="m-0 font-normal text-muted-foreground">Check the cart, then select the shipping.</p>
      </div>
    );

    if (step === 'emptyCart') {
      return (
        <div className="grid gap-6 text-sm font-medium">
          {header}
          <div className="grid justify-items-center gap-3 rounded-lg px-4 py-10 shadow-code text-center">
            <ShoppingBag className="size-5 text-muted-foreground" />
            <p className="m-0 font-normal text-muted-foreground">Your cart is empty.</p>
            <Button variant="outline" onClick={() => send({ type: 'RESTORE_ITEMS' })}>
              Add the items again
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="grid gap-6 text-sm font-medium">
        {header}

        <ul aria-label="Cart" className="grid gap-3">
          {items.map((item) => {
            const less: CheckoutEvent =
              item.qty > 1 ? { type: 'SET_QTY', id: item.id, qty: item.qty - 1 } : { type: 'REMOVE_ITEM', id: item.id };

            const more: CheckoutEvent = { type: 'SET_QTY', id: item.id, qty: item.qty + 1 };

            return (
              <li key={item.id} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-foreground">{item.name}</span>
                <div role="group" aria-label={`Quantity of ${item.name}`} className="flex items-center rounded-lg shadow-code">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={item.qty > 1 ? `Remove one ${item.name}` : `Remove ${item.name} from the cart`}
                    title={item.qty > 1 ? 'Remove one' : 'Remove from the cart'}
                    disabled={!view.can(less)}
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
                    disabled={item.qty >= maxQty || !view.can(more)}
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
          <legend className="mb-2">Shipping</legend>
          <RadioGroup
            value={shipping.key}
            onValueChange={(key) => {
              const option = shippingOptions.find((candidate) => candidate.key === key);

              if (option) send(option.event);
            }}
          >
            {shippingOptions.map((option) => (
              <RadioCard key={option.key} value={option.key} icon={option.Icon} disabled={!view.can(option.event)}>
                {option.label}
                <span className="ml-auto text-muted-foreground">{feeOf(option)}</span>
              </RadioCard>
            ))}
          </RadioGroup>
        </fieldset>

        <div className="grid gap-4">
          {summary(false)}
          <Button size="lg" className="w-full" disabled={!view.can({ type: 'CONTINUE' })} onClick={() => send({ type: 'CONTINUE' })}>
            Continue to payment
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="grid gap-6 text-sm font-medium"
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
          disabled={!view.can({ type: 'BACK' })}
          onClick={() => send({ type: 'BACK' })}
        >
          <ArrowLeft />
          Cart
        </Button>
        <div className="grid gap-1">
          <h3 className="m-0 font-semibold">Payment</h3>
          <p className="m-0 font-normal text-muted-foreground">Enter the card details.</p>
        </div>
      </div>

      <div className="grid gap-3">
        <div className="grid gap-2">
          <Label htmlFor="card-number">Card number</Label>
          <Input
            id="card-number"
            className="h-9 border-transparent font-mono shadow-code"
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
              className="h-9 border-transparent font-mono shadow-code"
              placeholder="MM/YY"
              aria-invalid={expiryError !== undefined || undefined}
              {...cardInput('expiry')}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="card-cvc">CVC</Label>
            <Input id="card-cvc" className="h-9 border-transparent font-mono shadow-code" placeholder="123" {...cardInput('cvc')} />
          </div>
        </div>
        {cardError && (
          <p id="card-error" role="alert" className="m-0 text-[13px] text-destructive">
            {cardError}
          </p>
        )}
      </div>

      <div className="grid gap-4">
        {summary(true)}
        {failed ? (
          <div className="grid gap-1">
            <Button type="button" size="lg" className="w-full" onClick={() => send({ type: 'RETRY' })}>
              Retry
            </Button>
            <Button type="button" variant="ghost" size="lg" className="w-full" onClick={() => send({ type: 'EDIT_CARD' })}>
              Edit card
            </Button>
          </div>
        ) : (
          <Button type="submit" size="lg" className="w-full" disabled={!view.can({ type: 'PAY' })}>
            {busy ? 'Processing…' : `Pay ${grandTotal}`}
          </Button>
        )}
      </div>
    </form>
  );
}

function stepOf(snapshot: SnapshotFrom<typeof checkoutMachine>): CheckoutState['step'] {
  if (snapshot.matches({ payment: 'idle' })) return snapshot.matches({ cart: 'empty' }) ? 'emptyCart' : 'cart';

  if (snapshot.matches({ payment: 'editing' })) return 'editing';

  if (snapshot.matches({ payment: 'processing' })) return 'processing';

  return snapshot.matches({ payment: 'error' }) ? 'error' : 'success';
}

export function XStateCheckout() {
  const [snapshot, send] = useMachine(checkoutMachine);

  const view = {
    ...snapshot.context,
    step: stepOf(snapshot),
    shipping: snapshot.value.shipping,
    can: (event: CheckoutEvent) => snapshot.can(event),
  };

  return <CheckoutScreen view={view} send={send} />;
}

export function ReducerCheckout() {
  const [state, dispatch] = useMachineReducer(checkoutReducerMachine, initialCheckout);

  // A handler returns the same state for an event that it ignores, so the reducer tells which events the state accepts.
  const view = {
    ...state.order,
    step: state.step,
    error: 'error' in state ? state.error : undefined,
    receiptId: 'receiptId' in state ? state.receiptId : undefined,
    can: (event: CheckoutEvent) => checkoutReducerMachine.reducer(state, event) !== state,
  };

  return <CheckoutScreen view={view} send={dispatch} />;
}

export const checkoutDemoFixtures = [...fixturesInEveryBuild, checkoutReducerFixtures];

const apps = { xstate: <XStateCheckout />, reducer: <ReducerCheckout /> };

export function CheckoutWindow({ href, sources }: { href: string; sources: DemoSources }) {
  return <DemoWindow apps={apps} fixtures={checkoutDemoFixtures} href={href} sources={sources} />;
}

type CheckoutExampleProps = { fixturesHref: string; pageHref: string; sources: DemoSources };

export function CheckoutExample({ fixturesHref, pageHref, sources }: CheckoutExampleProps) {
  const [adapter] = useAdapter();
  const xstate = adapter === 'xstate';

  return (
    <>
      <p>
        A checkout page with the real overlay docked beside it. The panel lists the checkout machine and all of its
        states, also the states that the page has not gone to. Select <strong>XState</strong> or{' '}
        <strong>Reducer</strong> to see the same checkout with each adapter.
      </p>
      <CheckoutWindow href={pageHref} sources={sources} />
      <div className="prose">
        <ol>
          <li>
            Click the bubble to open the panel. Select <strong>{xstate ? 'checkout' : 'checkout-reducer'}</strong>, then{' '}
            <strong>error</strong>
            {xstate && (
              <>
                {' '}
                under <strong>payment</strong>
              </>
            )}
            . The checkout shows Card declined. You did not have to type a declined card and pay to get there.
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
                <code>R</code>
              </TableCell>
              <TableCell>
                The last context that the real machine had in this state. It stays in <code>sessionStorage</code>, so
                it is still there after a reload.
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Fixture</TableCell>
              <TableCell>
                <code>F</code>
              </TableCell>
              <TableCell>
                Context that you wrote with <code>defineFixtures()</code>.
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>None</TableCell>
              <TableCell>
                <code>–</code>
              </TableCell>
              <TableCell>
                {xstate
                  ? 'The preview uses the live context of the real actor, and logs a warning, because the live context often does not agree with the state.'
                  : 'The state is greyed out, and you cannot preview it, because the live state object fits only the state that the machine is in.'}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p>
          This demo has a <Link href={fixturesHref}>fixture</Link> for each state, so each state has data for a
          preview.
        </p>
        <p className="border-l-2 border-muted-foreground/30 px-4 py-3 text-[13px] text-muted-foreground">
          This site builds konat in development mode for the demo. In your production build,{' '}
          <code>&lt;Konat /&gt;</code> renders nothing.
        </p>
      </div>
    </>
  );
}
