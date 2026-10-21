// The hooks of konat/xstate next to their @xstate/react twins, and the versions of React and XState that the
// test matrix (scripts/test-matrix.mjs) runs.

import * as xstateReact from '@xstate/react';
import * as React from 'react';
import * as konat from 'konat/xstate';
import type { DebugOptions } from 'konat/xstate';
import { describe } from 'vitest';
import { createActor, createMachine, type ActorOptions, type AnyActorLogic } from 'xstate';

/** The hooks that both packages export, typed as @xstate/react's. */
export type Hooks = typeof xstateReact;

/**
 * The rows of a `describe.each` for a test that claims parity with @xstate/react.
 * @xstate/react never registers its actors, so `previews` is false for it: skip the overlay steps and expect the same
 * values.
 */
export const IMPLEMENTATIONS: [name: string, hooks: Hooks, previews: boolean][] = [
  ['@xstate/react (control)', xstateReact, false],
  ['konat/xstate', konat, true],
];

/**
 * True when XState's own actors have select(), which XState 5.29 added.
 * The proxies of konat have select() with every supported XState, so only the @xstate/react rows need this.
 */
export const ACTOR_SELECT = 'select' in createActor(createMachine({}));

/** True when React has <Activity>, which React 19.2 added. */
export const HAS_ACTIVITY = 'Activity' in React;

/** A describe that runs only when React has <Activity>. It skips with React 18. */
export const describeWithActivity = HAS_ACTIVITY ? describe : describe.skip;

/**
 * The options of a hook with `debug`, in a type that the hooks of @xstate/react also accept.
 * @xstate/react ignores `debug`, so a test can give these options to the hooks of both packages.
 */
export function withDebug(debug: DebugOptions): ActorOptions<AnyActorLogic> & { debug: DebugOptions } {
  return { debug };
}

/** The major version of the installed React: 18 or 19. */
export const REACT_MAJOR = Number(React.version.split('.')[0]);
