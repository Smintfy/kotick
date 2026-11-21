// The shiru/reducer entry.
// It has no directive, so server code that imports a machine file gets the real defineReducerMachine.
// The hook comes from ./reducer/hook, which is a 'use client' module.

export { defineReducerMachine } from './reducer/machine';

export type { MachineEvent, MachineReducerOptions, ReducerMachine } from './reducer/machine';

export { defineFixtures } from './reducer/define-fixtures';

export type { CompleteFixtures, ReducerFixtures } from './reducer/define-fixtures';

export { useMachineReducer } from './reducer/hook';
