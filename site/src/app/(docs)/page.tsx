import Link from 'next/link';
import type { ReactNode } from 'react';
import { Pager } from '@/components/pager';
import { Demo } from '@/demo/Demo';
import { costs } from '@/content/costs';
import { checkedHref, demoHref, type LandingId, landingHeadings, pitch } from '@/site';

const features: ReadonlyArray<{ title: string; body: ReactNode }> = [
  {
    title: 'Every state, in context',
    body: 'Previews render in the running app, not in a separate story or sandbox.',
  },
  {
    title: 'Safe',
    body: 'A preview changes only what components see. The real actor keeps running, and events that the UI sends during a preview are blocked and logged.',
  },
  {
    title: 'Realistic data',
    body: 'Previews use context recorded from earlier visits, context you write as fixtures, or the live context. The panel shows which one it uses.',
  },
  {
    title: 'Gone in production',
    body: (
      <>
        Production builds keep a component that renders nothing and re-exports of <code>@xstate/react</code>.
      </>
    ),
  },
];

export default function Home() {
  const bodies: Record<LandingId, ReactNode> = {
    konat: (
      <p>
        <code>{'<Konat />'}</code> is a development overlay for React apps that use state machines. It lists each
        machine that runs on the page and all of its states, also the states the UI never went to. Click a state to show
        it in the real app, with real layout and data. You do not have to click through the flow, slow down the network,
        or force an API error to get there. This version supports XState v5.
      </p>
    ),
    'how-it-works': <Demo fixturesHref={checkedHref('/docs/fixtures')} pageHref={demoHref('checkout')} />,
    why: (
      <>
        <p>
          Two changes to your app. In development, a transition costs{' '}
          <Link href={checkedHref('/docs/production#performance-in-development')}>{costs.transition}</Link> more than with{' '}
          <code>@xstate/react</code>. In production, the startup JavaScript grows by{' '}
          <Link href={checkedHref('/docs/production')}>{costs.startup}</Link> gzip with esbuild and Vite.
        </p>
        <ul className="list-disc pl-[22px] [&>li]:my-2">
          {features.map(({ title, body }) => (
            <li key={title}>
              <strong className="text-heading">{title}.</strong> {body}
            </li>
          ))}
        </ul>
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
