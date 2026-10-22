import Link from 'next/link';
import type { ReactNode } from 'react';
import { Pager } from '@/components/pager';
import { Demo } from '@/demo/Demo';
import { costs, hrefFor, type LandingId, landingHeadings, pitch, renderBenefits, renderLead } from '@/site';

export default function Home() {
  const bodies: Record<LandingId, ReactNode> = {
    konat: <div className="prose">{renderLead()}</div>,
    'how-it-works': <Demo fixturesHref={hrefFor('fixtures')} />,
    why: (
      <>
        <p>
          Two changes to your app. In development, a transition costs{' '}
          <Link href={hrefFor('performance-in-development')}>{costs.transition}</Link> more than with{' '}
          <code>@xstate/react</code>. In production, the startup JavaScript grows by{' '}
          <Link href={hrefFor('production-builds')}>{costs.startup}</Link> gzip with esbuild and Vite.
        </p>
        <div className="prose intro">{renderBenefits()}</div>
      </>
    ),
  };

  return (
    <>
      <h1 className="sr-only">{pitch}</h1>
      {landingHeadings.map(({ id, text }, index) => (
        <section key={id} className="@container" aria-labelledby={id}>
          <h2 id={id} className={index === 0 ? 'mt-0' : 'mt-18'}>
            {text}
          </h2>
          {bodies[id]}
        </section>
      ))}
      <Pager href="/" />
    </>
  );
}
