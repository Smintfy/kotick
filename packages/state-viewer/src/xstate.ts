'use client';

// state-viewer/xstate: drop-in for @xstate/react. The only entry allowed to import xstate.

import * as xstateReact from '@xstate/react';
import type { AnyActorRef } from 'xstate';
import { connect as connectActor } from './xstate/connect';
import * as hooks from './xstate/hooks';

export { shallowEqual, useSelector } from '@xstate/react';
export { defineFixtures, type FixtureStates, type LeafIdFrom } from './xstate/define-fixtures';
export type { DebugOptions } from './xstate/options';

// Declared here rather than through @types/node, so apps that typecheck this source without Node types still compile.
declare const process: { env: { NODE_ENV?: string } };

// Bundlers replace process.env.NODE_ENV and remove the branch that production builds don't use.
// Production builds then keep @xstate/react's hooks and drop the rest.
// Write the condition at each use.
// esbuild, webpack and Turbopack don't copy the value of a `const DEV = …` into its uses, so they keep both branches.

export const useActorRef: typeof hooks.useActorRef =
  process.env.NODE_ENV !== 'production' ? hooks.useActorRef : (xstateReact.useActorRef as typeof hooks.useActorRef);

export const useActor: typeof hooks.useActor =
  process.env.NODE_ENV !== 'production' ? hooks.useActor : (xstateReact.useActor as typeof hooks.useActor);

export const useMachine: typeof hooks.useMachine =
  process.env.NODE_ENV !== 'production' ? hooks.useMachine : (xstateReact.useMachine as typeof hooks.useMachine);

export const createActorContext: typeof hooks.createActorContext =
  process.env.NODE_ENV !== 'production'
    ? hooks.createActorContext
    : (xstateReact.createActorContext as typeof hooks.createActorContext);

/**
 * Registers an actor created outside React and returns its proxy: export the return value, not the actor.
 * In production builds it returns the actor unchanged.
 */
export const connect: typeof connectActor =
  process.env.NODE_ENV !== 'production' ? connectActor : <TActor extends AnyActorRef>(actor: TActor) => actor;
