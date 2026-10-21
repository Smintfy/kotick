import { assign, setup } from 'xstate';

type ToggleCount = { count: number };

type ToggleEvent = { type: 'TOGGLE' };

export const toggleMachine = setup({
  // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
  types: { context: {} as ToggleCount, events: {} as ToggleEvent },
}).createMachine({
  id: 'toggle',
  initial: 'off',
  context: { count: 0 },
  states: {
    off: { on: { TOGGLE: { target: 'on', actions: assign({ count: ({ context }) => context.count + 1 }) } } },
    on: { on: { TOGGLE: 'off' } },
  },
});
