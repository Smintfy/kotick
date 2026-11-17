'use client';

import { ArrowLeft, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { type ComponentType, useState } from 'react';
import { type FixturesInput, Konat } from 'konat';
import { Button } from '@/components/ui/button';
import { fixturesInEveryBuild } from '@/demo/checkout';
import { Checkout } from '@/demo/Demo';
import { onboardingFixtures } from '@/demo/onboarding';
import { Onboarding } from '@/demo/onboarding-example';
import type { DemoId } from '@/site';

const apps = {
  checkout: { App: Checkout, fixtures: fixturesInEveryBuild },
  onboarding: { App: Onboarding, fixtures: onboardingFixtures },
} as const satisfies Record<DemoId, { App: ComponentType; fixtures: FixturesInput }>;

/** A demo app in the full window. The overlay is not docked, so the panel can use all of the window. */
export function DemoPage({ id, title, backHref }: { id: DemoId; title: string; backHref: string }) {
  const { App, fixtures } = apps[id];
  const [run, setRun] = useState(0);

  return (
    <>
      <header className="flex h-bar items-center px-4">
        <Button variant="ghost" className="-ml-1.5" nativeButton={false} render={<Link href={backHref} />}>
          <ArrowLeft />
          Docs
        </Button>
        <h1 className="sr-only">{title}</h1>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Reset"
          title="Reset"
          className="ml-auto text-muted-foreground"
          onClick={() => setRun(run + 1)}
        >
          <RotateCcw />
        </Button>
      </header>
      <main className="px-6 pt-14 pb-24">
        <div key={run} className="mx-auto max-w-[360px]">
          <App />
        </div>
      </main>
      <Konat fixtures={fixtures} />
    </>
  );
}
