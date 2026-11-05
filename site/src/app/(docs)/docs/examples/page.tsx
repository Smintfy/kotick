import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Pager } from '@/components/pager';
import { OnboardingExample } from '@/demo/onboarding-example';
import { checkedHref, demoHref, type ExampleId, examplesPage } from '@/site';

export const metadata: Metadata = { title: examplesPage.title, description: examplesPage.description };

export default function ExamplesPage() {
  const bodies: Record<ExampleId, ReactNode> = {
    onboarding: (
      <>
        <p>
          An onboarding flow in four steps. Each step is a state of the onboarding machine. Step 3 sends a request
          that can fail.
        </p>
        <OnboardingExample href={demoHref('onboarding')} />
        <div className="prose">
          <ol>
            <li>
              Click the bubble to open the panel. Select <strong>onboarding</strong>, then <strong>invite</strong>.
              The page shows step 4, with a name, a role, a workspace and an invite from the fixture. The email
              of a second teammate is in the field, so <strong>Add</strong> is ready to click. You did not have to
              complete steps 1 to 3 to get there.
            </li>
            <li>
              Click <strong>Skip for now</strong>. The machine does not get the event. Scroll down the panel to{' '}
              <strong>Blocked events</strong>. It lists SKIP.
            </li>
            <li>
              Select <strong>error</strong> under <strong>workspace</strong>. The page shows that the name Acme is
              taken. You did not have to send a request that fails.
            </li>
            <li>
              Select <strong>error</strong> again to release the preview. The page shows the real state again.
            </li>
          </ol>
          <p>
            Each state has a <Link href={checkedHref('/docs/fixtures')}>fixture</Link>, so no preview uses the live context.
          </p>
        </div>
      </>
    ),
  };

  return (
    <>
      <header className="mb-8">
        <h1>{examplesPage.title}</h1>
        <p className="mt-2 mb-4 text-muted-foreground">{examplesPage.description}</p>
      </header>
      {examplesPage.headings.map(({ id, text }, index) => (
        <section key={id} className="@container" aria-labelledby={id}>
          <h2 id={id} className={index === 0 ? 'mt-0' : 'mt-18'}>
            <a href={`#${id}`} className="text-inherit no-underline hover:underline">
              {text}
            </a>
          </h2>
          {bodies[id]}
        </section>
      ))}
      <Pager href={examplesPage.href} />
    </>
  );
}
