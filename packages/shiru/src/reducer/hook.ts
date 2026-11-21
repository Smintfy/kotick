'use client';

// The build packs this module as its own file, so its directive stays at the top.
// It is the only 'use client' module of shiru/reducer.
// In the server graph of a framework with server components, useMachineReducer is then a client reference.
// A call from a server component fails with a message that names the hook.

import { useDevMachineReducer } from './dev-hook';
import { useMachineReducer as useProductionMachineReducer } from './runtime';

// Declared here rather than through @types/node, so apps that typecheck this source without Node types still compile.
declare const process: { env: { NODE_ENV?: string } };

/**
 * Runs a reducer machine in a component. It returns `[state, dispatch]`, as useReducer does.
 * The condition is written at its one use, so a bundler drops the development hook from a production build.
 */
export const useMachineReducer: typeof useProductionMachineReducer =
  process.env.NODE_ENV !== 'production' ? useDevMachineReducer : useProductionMachineReducer;
