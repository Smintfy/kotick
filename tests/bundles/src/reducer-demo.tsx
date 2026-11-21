'use client';

// Uses every runtime export of shiru/reducer, with src/reducer-machine.ts, as an app does.
// The production build must keep only a small runtime over src/reducer-baseline.tsx.

import { useMachineReducer } from 'shiru/reducer';
import { toggleReducerMachine } from './reducer-machine';

export function ReducerDemo() {
  const [state, dispatch] = useMachineReducer(toggleReducerMachine, { status: 'off', count: 0 });

  return (
    <button id="reducer-demo" type="button" onClick={() => dispatch({ type: 'TOGGLE' })}>
      {state.status}
    </button>
  );
}
