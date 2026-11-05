'use client';

import Link from 'next/link';
import { useMachine } from 'konat/xstate';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { type CheckoutEvent, checkoutMachine, fixturesInEveryBuild } from '@/demo/checkout';
import { DemoWindow } from '@/demo/demo-window';

const shippingOptions = [
  { key: 'standard', label: 'Standard', fee: 0, event: { type: 'SHIP_STANDARD' } },
  { key: 'express', label: 'Express', fee: 1500, event: { type: 'SHIP_EXPRESS' } },
  { key: 'pickup', label: 'Pickup', fee: 0, event: { type: 'SHIP_PICKUP' } },
] as const satisfies ReadonlyArray<{ key: string; label: string; fee: number; event: CheckoutEvent }>;

const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function Checkout() {
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
        <RadioGroup
          className="gap-0 divide-y rounded-lg border"
          value={shipping.key}
          onValueChange={(key) => {
            const option = shippingOptions.find((candidate) => candidate.key === key);

            if (option) send(option.event);
          }}
        >
          {shippingOptions.map((option) => (
            <Label key={option.key} className="cursor-pointer gap-2.5 px-2.5 py-2 leading-normal font-normal">
              <RadioGroupItem value={option.key} disabled={!snapshot.can(option.event)} />
              {option.label}
              <span className="ml-auto text-muted-foreground">{option.fee ? formatPrice(option.fee) : 'Free'}</span>
            </Label>
          ))}
        </RadioGroup>
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
          <Label htmlFor="card-number">Card number</Label>
          <Input
            id="card-number"
            className="font-mono"
            value={cardNumber}
            inputMode="numeric"
            autoComplete="off"
            placeholder="4242 4242 4242 4242"
            onChange={(event) => send({ type: 'UPDATE_CARD', cardNumber: event.target.value })}
          />
          <p className="m-0 text-[13px] text-muted-foreground">Any 16 digits pay. Cards that end in 0002 are declined.</p>
          <Button type="submit" size="lg" className="mt-2 justify-self-start" disabled={!snapshot.can({ type: 'PAY' })}>
            Pay {grandTotal}
          </Button>
        </form>
      )}

      {snapshot.hasTag('busy') && <p role="status" className="m-0">
          Processing payment…
        </p>}

      {snapshot.matches({ payment: 'error' }) && (
        <Alert variant="destructive" className="gap-2.5 px-3.5 py-3">
          <AlertDescription>{error ?? 'Payment failed'}</AlertDescription>
          <div className="flex gap-2">
            <Button onClick={() => send({ type: 'RETRY' })}>Retry</Button>
            <Button variant="secondary" onClick={() => send({ type: 'EDIT_CARD' })}>
              Edit card
            </Button>
          </div>
        </Alert>
      )}

      {snapshot.matches({ payment: 'success' }) && (
        <Alert role="status" className="px-3.5 py-3">
          <AlertDescription className="text-foreground">
            Paid. Receipt <code>{receiptId}</code>
          </AlertDescription>
        </Alert>
      )}
    </div>
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
        <Table className="mb-4">
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead className="w-20">Mark</TableHead>
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
              <TableCell className="whitespace-normal">
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
              <TableCell className="whitespace-normal">
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
              <TableCell className="whitespace-normal">
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
