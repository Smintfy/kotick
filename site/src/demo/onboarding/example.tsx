'use client';

import { DemoWindow } from '@/demo/demo-window';
import { onboardingFixtures } from '@/demo/onboarding/fixtures';
import { Onboarding } from '@/demo/onboarding/onboarding';
import type { DemoSource } from '@/demo/source';

export function OnboardingWindow({ href, source }: { href: string; source: DemoSource }) {
  return (
    <DemoWindow fixtures={onboardingFixtures} href={href} source={source}>
      <Onboarding />
    </DemoWindow>
  );
}
