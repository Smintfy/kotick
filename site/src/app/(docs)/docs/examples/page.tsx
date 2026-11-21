import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Pager } from '@/components/pager';
import { CheckoutWindow } from '@/demo/checkout/example';
import { OnboardingWindow } from '@/demo/onboarding/example';
import { demoSources } from '@/components/demo/source';
import { checkedHref, demoHref, type ExampleId, examplesPage } from '@/site';

export const metadata: Metadata = { title: examplesPage.title, description: examplesPage.description };

export default function ExamplesPage() {
  const bodies: Record<ExampleId, ReactNode> = {
    checkout: (
      <>
        <p>
          A checkout page. The reducer machine has one state for each step of the page. The XState machine has
          parallel regions for the cart, the shipping and the payment. The payment sends a request that can fail.
        </p>
        <CheckoutWindow href={demoHref('checkout')} sources={demoSources('checkout')} />
      </>
    ),
    onboarding: (
      <>
        <p>
          An onboarding flow in four steps. Each step is a state of the onboarding machine. Step 3 sends a request
          that can fail. The reducer machine has a state of its own for each state of the request, and the XState
          machine keeps them under <code>workspace</code>.
        </p>
        <OnboardingWindow href={demoHref('onboarding')} sources={demoSources('onboarding')} />
      </>
    ),
  };

  return (
    <>
      <article className="prose">
        <header className="mb-8">
          <h1>{examplesPage.title}</h1>
        </header>
        <p>
          Each demo is one app with a version for each adapter. Select <strong>useReducer</strong> or{' '}
          <strong>XState</strong> above it to change the version. The panel then lists the machine of that version.
        </p>
        <p>
          The Code tab of each demo shows its component, its machine and its fixtures, each in a file. The demos
          give the fixtures to{' '}
          <code>&lt;Kotick /&gt;</code> as an array, so the fixtures are in each build of this site. In your app, use a
          loader with a development condition. Refer to{' '}
          <Link href={checkedHref('/docs/fixtures#define-fixtures')}>Define fixtures</Link>.
        </p>
        {examplesPage.headings.map(({ id, text }) => (
          <section key={id} aria-labelledby={id}>
            <h2 id={id}>
              <a href={`#${id}`} className="text-inherit no-underline hover:underline">
                {text}
              </a>
            </h2>
            {bodies[id]}
          </section>
        ))}
      </article>
      <Pager href={examplesPage.href} />
    </>
  );
}
