'use client';

// Uses every runtime export of konat/reducer, as an app does.
// The production build must keep only a small runtime over src/reducer-baseline.tsx.

import { defineReducerMachine, useMachineReducer } from 'konat/reducer';

type ToggleState = { status: 'off'; count: number } | { status: 'on'; count: number };

type ToggleEvent = { type: 'TOGGLE' };

export const toggleReducerMachine = defineReducerMachine<ToggleState, ToggleEvent>()({
  id: 'toggle-reducer',
  discriminant: 'status',
  states: {
    off: { on: { TOGGLE: (state) => ({ status: 'on', count: state.count + 1 }) } },
    on: {
      on: { TOGGLE: (state) => ({ status: 'off', count: state.count }) },
      effect: (_state, send) => {
        const timer = setTimeout(() => send({ type: 'TOGGLE' }), 1000);

        return () => clearTimeout(timer);
      },
    },
  },
});

export function ReducerDemo() {
  const [state, dispatch] = useMachineReducer(toggleReducerMachine, { status: 'off', count: 0 });

  return (
    <button type="button" onClick={() => dispatch({ type: 'TOGGLE' })}>
      {state.status}
    </button>
  );
}
