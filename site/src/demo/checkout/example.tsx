'use client';

import Link from 'next/link';
import { useAdapter } from '@/components/docs/adapter-tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkout as ReducerCheckout } from '@/demo/checkout/reducer/checkout';
import { checkoutReducerFixtures } from '@/demo/checkout/reducer/fixtures';
import { Checkout as XStateCheckout } from '@/demo/checkout/xstate/checkout';
import { fixturesInEveryBuild } from '@/demo/checkout/xstate/fixtures';
import { DemoWindow } from '@/components/demo/demo-window';
import type { DemoSources } from '@/components/demo/source';

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
        states, also the states that the page has not gone to. Select <strong>useReducer</strong> or{' '}
        <strong>XState</strong> to see the same checkout with each adapter.
      </p>
      <CheckoutWindow href={pageHref} sources={sources} />
      <div className="prose">
        <ol>
          <li>
            Click the bubble to open the panel. Select <strong>{xstate ? 'checkout-xstate' : 'checkout-reducer'}</strong>, then{' '}
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
        <p className="border-l-2 border-muted-foreground/30 px-4 py-3 text-sm text-muted-foreground">
          This site builds konat in development mode for the demo. In your production build,{' '}
          <code>&lt;Konat /&gt;</code> renders nothing.
        </p>
      </div>
    </>
  );
}
