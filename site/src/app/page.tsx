import Link from 'next/link';
import type { ReactNode } from 'react';
import { InstallTabs } from '@/components/InstallTabs';
import { Mark } from '@/components/Mark';
import { Demo } from '@/demo/Demo';
import {
  costs,
  hrefFor,
  type LandingId,
  landingHeadings,
  packageName,
  pages,
  pitch,
  renderIntro,
  renderQuickStart,
} from '@/site';

export default function Home() {
  const bodies: Record<LandingId, ReactNode> = {
    'how-it-works': <Demo fixturesHref={hrefFor('fixtures')} />,
    why: (
      <>
        <p>
          Two changes to your app. In development, a transition costs{' '}
          <Link href={hrefFor('performance-in-development')}>{costs.transition}</Link> more than with{' '}
          <code>@xstate/react</code>. In production, the startup JavaScript grows by{' '}
          <Link href={hrefFor('production-builds')}>{costs.startup}</Link> gzip with esbuild and Vite.
        </p>
        <div className="prose intro">{renderIntro()}</div>
      </>
    ),
    install: (
      <>
        <InstallTabs name={packageName} />
        <div className="prose">{renderQuickStart()}</div>
        <p>
          <Link href={hrefFor('install')}>Read Getting started</Link>
        </p>
      </>
    ),
    explore: (
      <ul className="cards">
        {pages.map((page) => (
          <li key={page.slug}>
            <Link href={page.href}>
              <strong>{page.title}</strong>
              <span>{page.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    ),
  };

  return (
    <>
      <header className="hero">
        <Mark size={64} />
        <h1 className="pitch">{pitch}</h1>
        <p className="hero-links">
          <a href="#install">Install</a>
          <Link href={pages[0].href}>Read the docs</Link>
        </p>
      </header>
      {landingHeadings.map(({ id, text }) => (
        <section key={id} className="landing-section" aria-labelledby={id}>
          <h2 id={id}>{text}</h2>
          {bodies[id]}
        </section>
      ))}
    </>
  );
}
