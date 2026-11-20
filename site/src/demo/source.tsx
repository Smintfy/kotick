import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { HighlightedPre } from '@/components/docs/code-block';
import type { Adapter } from '@/content/adapters';
import type { DemoId } from '@/site';

export type DemoSource = { text: string; pre: ReactNode };

export type DemoSources = Record<Adapter, DemoSource>;

function demoSource(id: DemoId, file: string): DemoSource {
  const text = readFileSync(join(process.cwd(), 'src/demo', id, file), 'utf8').replace(/\n$/, '');

  return { text, pre: <HighlightedPre text={text} lang="ts" /> };
}

export function demoSources(id: DemoId): DemoSources {
  return { xstate: demoSource(id, 'xstate-machine.ts'), reducer: demoSource(id, 'reducer-machine.ts') };
}
