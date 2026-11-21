'use client';

import type { ReactNode } from 'react';
import { Kotick as DevKotick } from './components/kotick';
import type { KotickProps } from './types';

export type { FixtureSet, FixturesInput, FixturesResult, Position, KotickProps } from './types';

// Declared here, not through @types/node, so apps that typecheck this source without Node types still compile.
declare const process: { env: { NODE_ENV?: string } };

function ProductionKotick(_props: KotickProps): null {
  return null;
}

/**
 * Lists every state machine on the page and previews any of its states in place. Renders nothing in production
 * builds, and its fixtures loader is never called there.
 */
export const Kotick: (props: KotickProps) => ReactNode =
  process.env.NODE_ENV !== 'production' ? DevKotick : ProductionKotick;
