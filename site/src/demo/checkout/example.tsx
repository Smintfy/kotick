'use client';

import Link from 'next/link';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkout } from '@/demo/checkout/checkout';
import { fixturesInEveryBuild } from '@/demo/checkout/fixtures';
import { DemoWindow } from '@/demo/demo-window';
import type { DemoSource } from '@/demo/source';

export function CheckoutWindow({ href, source }: { href: string; source: DemoSource }) {
  return (
    <DemoWindow fixtures={fixturesInEveryBuild} href={href} source={source}>
      <Checkout />
    </DemoWindow>
  );
}

type CheckoutExampleProps = { fixturesHref: string; pageHref: string; source: DemoSource };

export function CheckoutExample({ fixturesHref, pageHref, source }: CheckoutExampleProps) {
  return (
    <>
      <p>
        A checkout page with the real overlay docked beside it. The panel lists the checkout machine and all of its
        states, also the states that the page has not gone to.
      </p>
      <CheckoutWindow href={pageHref} source={source} />
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
                <code>R</code>
              </TableCell>
              <TableCell>
                The last context that the real actor had in this state. It stays in <code>sessionStorage</code>, so it
                is still there after a reload.
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
                The preview uses the live context of the real actor, and logs a warning, because the live context often
                does not agree with the state.
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p>
          This demo has a <Link href={fixturesHref}>fixture</Link> for each state, so no preview uses the live context.
        </p>
        <p className="border-l-2 border-muted-foreground/30 px-4 py-3 text-[13px] text-muted-foreground">
          This site builds konat in development mode for the demo. In your production build,{' '}
          <code>&lt;Konat /&gt;</code> renders nothing.
        </p>
      </div>
    </>
  );
}
