'use client';

import * as xstateReact from '@xstate/react';
import type { AnyActorRef } from 'xstate';
import { connect as connectActor } from './xstate/connect';
import * as hooks from './xstate/hooks';

export { shallowEqual } from '@xstate/react';

export { defineFixtures, type FixtureStates, type LeafIdFrom } from './xstate/define-fixtures';

export type { DebugOptions } from './xstate/options';

// Declared here rather than through @types/node, so apps that typecheck this source without Node types still compile.
declare const process: { env: { NODE_ENV?: string } };

// Write the condition at each use.
// esbuild doesn't copy the value of a `const DEV = …` into its uses, so it keeps both branches.

// SAFETY: In production, each export is @xstate/react's own hook. The dev hook has the same signature, plus the `debug`
// option in the options, which XState ignores.
export const useActorRef: typeof hooks.useActorRef =
  process.env.NODE_ENV !== 'production' ? hooks.useActorRef : (xstateReact.useActorRef as typeof hooks.useActorRef);

// SAFETY: As for useActorRef.
export const useActor: typeof hooks.useActor =
  process.env.NODE_ENV !== 'production' ? hooks.useActor : (xstateReact.useActor as typeof hooks.useActor);

// SAFETY: As for useActorRef.
export const useMachine: typeof hooks.useMachine =
  process.env.NODE_ENV !== 'production' ? hooks.useMachine : (xstateReact.useMachine as typeof hooks.useMachine);

export const useSelector: typeof xstateReact.useSelector =
  process.env.NODE_ENV !== 'production' ? hooks.useSelector : xstateReact.useSelector;

// SAFETY: As for useActorRef.
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
