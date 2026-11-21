'use client';

import type { ReactNode } from 'react';
import { Shiru as DevShiru } from './components/shiru';
import type { ShiruProps } from './types';

export type { FixtureSet, FixturesInput, FixturesResult, Position, ShiruProps } from './types';

// Declared here, not through @types/node, so apps that typecheck this source without Node types still compile.
declare const process: { env: { NODE_ENV?: string } };

function ProductionShiru(_props: ShiruProps): null {
  return null;
}

/**
 * Lists every state machine on the page and previews any of its states in place. Renders nothing in production
 * builds, and its fixtures loader is never called there.
 */
export const Shiru: (props: ShiruProps) => ReactNode =
  process.env.NODE_ENV !== 'production' ? DevShiru : ProductionShiru;
