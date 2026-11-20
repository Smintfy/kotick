import 'server-only';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ReactNode } from 'react';
import { HighlightedPre } from '@/components/docs/code-block';
import type { DemoId } from '@/site';

export type DemoFile = { name: string; text: string; pre: ReactNode };

export type DemoSource = { files: [DemoFile, ...DemoFile[]] };

const paths: Record<DemoId, [string, ...string[]]> = {
  checkout: ['checkout/checkout.tsx', 'checkout/machine.ts', 'checkout/fixtures.ts', 'radio-card.tsx'],
  onboarding: ['onboarding/onboarding.tsx', 'onboarding/machine.ts', 'onboarding/fixtures.ts', 'radio-card.tsx'],
};

function demoFile(path: string): DemoFile {
  const text = readFileSync(join(process.cwd(), 'src/demo', path), 'utf8').replace(/\n$/, '');
  const lang = path.endsWith('.tsx') ? 'tsx' : 'ts';

  return { name: basename(path), text, pre: <HighlightedPre text={text} lang={lang} /> };
}

export function demoSource(id: DemoId): DemoSource {
  const [first, ...rest] = paths[id];

  return { files: [demoFile(first), ...rest.map(demoFile)] };
}
