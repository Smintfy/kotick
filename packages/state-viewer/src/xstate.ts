// state-viewer/xstate: drop-in for @xstate/react (spec §8.2). The only entry allowed to import xstate.

import * as xstateReact from '@xstate/react';
import type { AnyActorRef } from 'xstate';
import { connect as connectActor } from './xstate/connect';
import * as hooks from './xstate/hooks';

export { shallowEqual, useSelector } from '@xstate/react';
export { defineFixtures, type FixtureStates, type LeafIdFrom } from './xstate/fixtures';
export type { DebugOptions } from './xstate/types';

// Declared here rather than through @types/node, so apps that typecheck this source without Node types still compile.
declare const process: { env: { NODE_ENV?: string } };

// R28: bundlers replace process.env.NODE_ENV, so production builds keep @xstate/react's hooks and drop the rest.
const DEV = process.env.NODE_ENV !== 'production';

export const useActorRef: typeof hooks.useActorRef = DEV
  ? hooks.useActorRef
  : (xstateReact.useActorRef as typeof hooks.useActorRef);

export const useActor: typeof hooks.useActor = DEV ? hooks.useActor : (xstateReact.useActor as typeof hooks.useActor);

export const useMachine: typeof hooks.useMachine = DEV
  ? hooks.useMachine
  : (xstateReact.useMachine as typeof hooks.useMachine);

export const createActorContext: typeof hooks.createActorContext = DEV
  ? hooks.createActorContext
  : (xstateReact.createActorContext as typeof hooks.createActorContext);

/**
 * Registers an actor created outside React (R2) and returns its proxy: export the return value, not the actor.
 * In production builds it returns the actor unchanged.
 */
export const connect: typeof connectActor = DEV ? connectActor : <TActor extends AnyActorRef>(actor: TActor) => actor;
