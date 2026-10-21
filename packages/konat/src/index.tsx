'use client';

import type { ReactNode } from 'react';
import type { KonatProps } from './overlay/props';
import { Konat as DevKonat } from './overlay/Konat';

export type { FixtureSet } from './core/types';

export type { FixturesInput, FixturesResult, Position, KonatProps, Theme } from './overlay/props';

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
