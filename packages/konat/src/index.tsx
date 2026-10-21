'use client';

import type { ReactNode } from 'react';
import { Konat as DevKonat } from './components/konat';
import type { KonatProps } from './types';

export type { FixtureSet, FixturesInput, FixturesResult, Position, KonatProps, Theme } from './types';

// As in xstate.ts: declared here rather than through @types/node, for apps that typecheck this source without it.
declare const process: { env: { NODE_ENV?: string } };

function ProductionKonat(_props: KonatProps): null {
  return null;
}

/**
 * Lists every XState machine on the page and previews any of its states in place. Renders nothing in production
 * builds, and its fixtures loader is never called there.
 */
export const Konat: (props: KonatProps) => ReactNode =
  process.env.NODE_ENV !== 'production' ? DevKonat : ProductionKonat;
