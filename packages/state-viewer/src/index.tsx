'use client';

import type { ReactNode } from 'react';
import type { StateViewerProps } from './overlay/props';
import { StateViewer as DevStateViewer } from './overlay/StateViewer';

export type { FixtureSet } from './core/types';
export type { FixturesInput, FixturesResult, Position, StateViewerProps, Theme } from './overlay/props';

// As in xstate.ts: declared here rather than through @types/node, for apps that typecheck this source without it.
declare const process: { env: { NODE_ENV?: string } };

function ProductionStateViewer(_props: StateViewerProps): null {
  return null;
}

/**
 * Lists every XState machine on the page and previews any of its states in place. Renders nothing in production
 * builds, and its fixtures loader is never called there.
 */
export const StateViewer: (props: StateViewerProps) => ReactNode =
  process.env.NODE_ENV !== 'production' ? DevStateViewer : ProductionStateViewer;
