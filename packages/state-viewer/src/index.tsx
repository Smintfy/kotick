'use client';

// state-viewer: the <StateViewer /> overlay (spec §8.1).

import type { ReactNode } from 'react';
import { StateViewer as DevStateViewer } from './overlay/StateViewer';
import type { StateViewerProps } from './overlay/types';

export type { FixtureSet } from './core/types';
export type { FixturesInput, FixturesResult, Position, StateViewerProps, Theme } from './overlay/types';

// As in xstate.ts: declared here rather than through @types/node, for apps that typecheck this source without it.
declare const process: { env: { NODE_ENV?: string } };

// R28: bundlers replace process.env.NODE_ENV and remove the branch that production builds don't use.
// Production builds then keep only the component that renders nothing.
// The overlay and the registry go with the import that is no longer used.
// Write the condition at each use, as in xstate.ts (spec §10.7).
// esbuild, webpack and Turbopack don't copy the value of a `const DEV = …` into its uses, so they keep both branches.

function ProductionStateViewer(_props: StateViewerProps): null {
  return null;
}

/**
 * Lists every XState machine on the page and previews any of its states in place. Renders nothing in production
 * builds, and its fixtures loader is never called there.
 */
export const StateViewer: (props: StateViewerProps) => ReactNode =
  process.env.NODE_ENV !== 'production' ? DevStateViewer : ProductionStateViewer;
