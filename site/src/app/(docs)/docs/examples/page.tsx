import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Pager } from '@/components/pager';
import { OnboardingExample } from '@/demo/onboarding/example';
import { demoHref, type ExampleId, examplesPage } from '@/site';

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
