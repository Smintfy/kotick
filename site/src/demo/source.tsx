import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { HighlightedPre } from '@/components/docs/code-block';
import type { DemoId } from '@/site';

export type DemoSource = { text: string; pre: ReactNode };

export function demoSource(id: DemoId): DemoSource {
  const text = readFileSync(join(process.cwd(), 'src/demo', id, 'machine.ts'), 'utf8').replace(/\n$/, '');

  return { text, pre: <HighlightedPre text={text} lang="ts" /> };
}
