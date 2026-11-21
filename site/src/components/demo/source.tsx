import 'server-only';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ReactNode } from 'react';
import { HighlightedPre } from '@/components/docs/code-block';
import type { Adapter } from '@/content/adapters';
import type { DemoId } from '@/site';

export type DemoFile = { name: string; text: string; pre: ReactNode };

export type DemoSource = { files: [DemoFile, ...DemoFile[]] };

export type DemoSources = Record<Adapter, DemoSource>;

const paths: Record<DemoId, Record<Adapter, [string, ...string[]]>> = {
  checkout: {
    xstate: [
      'checkout/xstate/checkout.tsx',
      'checkout/xstate/machine.ts',
      'checkout/xstate/fixtures.ts',
      'checkout/order.ts',
    ],
    reducer: [
      'checkout/reducer/checkout.tsx',
      'checkout/reducer/machine.ts',
      'checkout/reducer/fixtures.ts',
      'checkout/order.ts',
    ],
  },
  onboarding: {
    xstate: [
      'onboarding/xstate/onboarding.tsx',
      'onboarding/xstate/machine.ts',
      'onboarding/xstate/fixtures.ts',
      'onboarding/account.ts',
    ],
    reducer: [
      'onboarding/reducer/onboarding.tsx',
      'onboarding/reducer/machine.ts',
      'onboarding/reducer/fixtures.ts',
      'onboarding/account.ts',
    ],
  },
};

function demoFile(path: string): DemoFile {
  const text = readFileSync(join(process.cwd(), 'src/demo', path), 'utf8').replace(/\n$/, '');
  const lang = path.endsWith('.tsx') ? 'tsx' : 'ts';

  return { name: basename(path), text, pre: <HighlightedPre text={text} lang={lang} /> };
}

function demoSource([first, ...rest]: [string, ...string[]]): DemoSource {
  return { files: [demoFile(first), ...rest.map(demoFile)] };
}

export function demoSources(id: DemoId): DemoSources {
  return { xstate: demoSource(paths[id].xstate), reducer: demoSource(paths[id].reducer) };
}
