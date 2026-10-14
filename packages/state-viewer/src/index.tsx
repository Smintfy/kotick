// state-viewer: the <StateViewer /> overlay (spec §8.1).

import type { ReactNode } from 'react';
import { StateViewer as DevStateViewer } from './overlay/StateViewer';
import type { StateViewerProps } from './overlay/types';

export type { FixtureSet } from './core/types';
export type { FixturesInput, FixturesResult, Position, StateViewerProps, Theme } from './overlay/types';

// As in xstate.ts: declared here rather than through @types/node, for apps that typecheck this source without it.
declare const process: { env: { NODE_ENV?: string } };

// R28: bundlers replace process.env.NODE_ENV, so production builds keep only the component that renders nothing, and
// the overlay and registry are dropped with the import that's no longer used.
const DEV = process.env.NODE_ENV !== 'production';

function ProductionStateViewer(_props: StateViewerProps): null {
  return null;
}

/**
 * Lists every XState machine on the page and previews any of its states in place. Renders nothing in production
 * builds, and its fixtures loader is never called there.
 */
export const StateViewer: (props: StateViewerProps) => ReactNode = DEV ? DevStateViewer : ProductionStateViewer;
