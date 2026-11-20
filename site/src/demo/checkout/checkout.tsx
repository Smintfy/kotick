'use client';

import { ArrowLeft, Check, type LucideIcon, Minus, Plus, ShoppingBag, Store, Trash2, Truck, Zap } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useMachine } from 'konat/xstate';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup } from '@/components/ui/radio-group';
import {
  type Card,
  type CheckoutEvent,
  checkoutMachine,
  digitsOf,
  expiryProblem,
  maxQty,
  subtotalOf,
} from '@/demo/checkout/machine';
import { RadioCard } from '@/demo/radio-card';

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

  if (snapshot.matches({ payment: 'success' })) {
    return (
      <div role="status" className="grid gap-6 text-sm font-medium">
        <span className="grid size-11 place-items-center rounded-full bg-accent text-foreground">
          <Check className="size-5" />
        </span>
        <div className="grid gap-1">
          <h3 className="m-0 text-base font-medium">Payment complete</h3>
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

  if (snapshot.matches({ payment: 'idle' })) {
    const header = (
      <div className="grid gap-1">
        <h3 className="m-0 text-base font-medium">Checkout</h3>
        <p className="m-0 font-normal text-muted-foreground">Check the cart, then select the shipping.</p>
      </div>
    );

    if (snapshot.matches({ cart: 'empty' })) {
      return (
        <div className="grid gap-6 text-sm font-medium">
          {header}
          <div className="grid justify-items-center gap-3 rounded-lg px-4 py-10 shadow-edge text-center">
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
                <div role="group" aria-label={`Quantity of ${item.name}`} className="flex items-center rounded-lg shadow-edge">
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
          <legend className="mb-2">Shipping</legend>
          <RadioGroup
            value={shipping.key}
            onValueChange={(key) => {
              const option = shippingOptions.find((candidate) => candidate.key === key);

              if (option) send(option.event);
            }}
          >
            {shippingOptions.map((option) => (
              <RadioCard key={option.key} value={option.key} icon={option.Icon} disabled={!snapshot.can(option.event)}>
                {option.label}
                <span className="ml-auto text-muted-foreground">{feeOf(option)}</span>
              </RadioCard>
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
          disabled={!snapshot.can({ type: 'BACK' })}
          onClick={() => send({ type: 'BACK' })}
        >
          <ArrowLeft />
          Cart
        </Button>
        <div className="grid gap-1">
          <h3 className="m-0 text-base font-medium">Payment</h3>
          <p className="m-0 font-normal text-muted-foreground">Enter the card details.</p>
        </div>
      </div>

      <div className="grid gap-3">
        <div className="grid gap-2">
          <Label htmlFor="card-number">Card number</Label>
          <Input
            id="card-number"
            className="h-9 border-transparent font-mono shadow-edge"
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
              className="h-9 border-transparent font-mono shadow-edge"
              placeholder="MM/YY"
              aria-invalid={expiryError !== undefined || undefined}
              {...cardInput('expiry')}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="card-cvc">CVC</Label>
            <Input id="card-cvc" className="h-9 border-transparent font-mono shadow-edge" placeholder="123" {...cardInput('cvc')} />
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
          <Button type="submit" size="lg" className="w-full" disabled={!snapshot.can({ type: 'PAY' })}>
            {busy ? 'Processing…' : `Pay ${grandTotal}`}
          </Button>
        )}
      </div>
    </form>
  );
}
