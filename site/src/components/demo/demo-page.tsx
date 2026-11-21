'use client';

import { ArrowLeft, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { type ComponentType, useState } from 'react';
import { type FixturesInput, Konat } from 'konat';
import { AdapterSwitch, useAdapter } from '@/components/docs/adapter-tabs';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Adapter } from '@/content/adapters';
import { checkoutDemoFixtures } from '@/demo/checkout/example';
import { Checkout as ReducerCheckout } from '@/demo/checkout/reducer/checkout';
import { Checkout as XStateCheckout } from '@/demo/checkout/xstate/checkout';
import { onboardingDemoFixtures } from '@/demo/onboarding/example';
import { Onboarding as ReducerOnboarding } from '@/demo/onboarding/reducer/onboarding';
import { Onboarding as XStateOnboarding } from '@/demo/onboarding/xstate/onboarding';
import type { DemoId } from '@/site';

const demos = {
  checkout: { apps: { xstate: XStateCheckout, reducer: ReducerCheckout }, fixtures: checkoutDemoFixtures },
  onboarding: { apps: { xstate: XStateOnboarding, reducer: ReducerOnboarding }, fixtures: onboardingDemoFixtures },
} as const satisfies Record<DemoId, { apps: Record<Adapter, ComponentType>; fixtures: FixturesInput }>;

export function DemoPage({ id, title, backHref }: { id: DemoId; title: string; backHref: string }) {
  const [adapter] = useAdapter();
  const { apps, fixtures } = demos[id];
  const App = apps[adapter];
  const [run, setRun] = useState(0);

  return (
    <>
      <header className="relative flex h-bar items-center px-4">
        <Button variant="ghost" className="-ml-1.5" nativeButton={false} render={<Link href={backHref} />}>
          <ArrowLeft />
          Docs
        </Button>
        <h1 className="sr-only">{title}</h1>
        <div className="absolute left-1/2 -translate-x-1/2">
          <AdapterSwitch />
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Reset"
                className="ml-auto text-muted-foreground"
                onClick={() => setRun(run + 1)}
              />
            }
          >
            <RotateCcw />
          </TooltipTrigger>
          <TooltipContent>Reset</TooltipContent>
        </Tooltip>
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
