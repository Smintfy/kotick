import { defineReducerMachine } from 'kotick/reducer';

type ToggleState = { status: 'off'; count: number } | { status: 'on'; count: number };

type ToggleEvent = { type: 'TOGGLE' };

// app/page.tsx and app/api/reducer/route.ts import this file on the server, so it has no directive.
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
