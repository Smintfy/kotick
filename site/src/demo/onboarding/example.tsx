'use client';

import { DemoWindow } from '@/components/demo/demo-window';
import { onboardingReducerFixtures } from '@/demo/onboarding/reducer/fixtures';
import { Onboarding as ReducerOnboarding } from '@/demo/onboarding/reducer/onboarding';
import { onboardingFixtures } from '@/demo/onboarding/xstate/fixtures';
import { Onboarding as XStateOnboarding } from '@/demo/onboarding/xstate/onboarding';
import type { DemoSources } from '@/components/demo/source';

export const onboardingDemoFixtures = [...onboardingFixtures, onboardingReducerFixtures];

const apps = { xstate: <XStateOnboarding />, reducer: <ReducerOnboarding /> };

export function OnboardingWindow({ href, sources }: { href: string; sources: DemoSources }) {
  return <DemoWindow apps={apps} fixtures={onboardingDemoFixtures} href={href} sources={sources} />;
}
