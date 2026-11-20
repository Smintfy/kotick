'use client';

import { DemoWindow } from '@/demo/demo-window';
import { ReducerOnboarding, XStateOnboarding } from '@/demo/onboarding/onboarding';
import { onboardingReducerFixtures } from '@/demo/onboarding/reducer-fixtures';
import { onboardingFixtures } from '@/demo/onboarding/xstate-fixtures';
import type { DemoSources } from '@/demo/source';

export const onboardingDemoFixtures = [...onboardingFixtures, onboardingReducerFixtures];

const apps = { xstate: <XStateOnboarding />, reducer: <ReducerOnboarding /> };

export function OnboardingWindow({ href, sources }: { href: string; sources: DemoSources }) {
  return <DemoWindow apps={apps} fixtures={onboardingDemoFixtures} href={href} sources={sources} />;
}
