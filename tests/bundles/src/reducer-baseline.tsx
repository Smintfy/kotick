'use client';

// src/reducer-demo.tsx written with useReducer, a switch and useEffect, without shiru.
// A production build of the reducer demo must stay close to this.

import { useEffect, useReducer } from 'react';

type ToggleState = { status: 'off'; count: number } | { status: 'on'; count: number };

type ToggleEvent = { type: 'TOGGLE' };

function toggleReducer(state: ToggleState, event: ToggleEvent): ToggleState {
  switch (state.status) {
    case 'off':
      return event.type === 'TOGGLE' ? { status: 'on', count: state.count + 1 } : state;
    case 'on':
      return event.type === 'TOGGLE' ? { status: 'off', count: state.count } : state;
  }
}

export function ReducerDemo() {
  const [state, dispatch] = useReducer(toggleReducer, { status: 'off', count: 0 });

  useEffect(() => {
    if (state.status !== 'on') return undefined;
    const timer = setTimeout(() => dispatch({ type: 'TOGGLE' }), 1000);

    return () => clearTimeout(timer);
  }, [state.status]);

  return (
    <button id="reducer-demo" type="button" onClick={() => dispatch({ type: 'TOGGLE' })}>
      {state.status}
    </button>
  );
}
