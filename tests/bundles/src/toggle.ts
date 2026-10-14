import { assign, setup } from 'xstate';

export const toggleMachine = setup({
  types: { context: {} as { count: number }, events: {} as { type: 'TOGGLE' } },
}).createMachine({
  id: 'toggle',
  initial: 'off',
  context: { count: 0 },
  states: {
    off: { on: { TOGGLE: { target: 'on', actions: assign({ count: ({ context }) => context.count + 1 }) } } },
    on: { on: { TOGGLE: 'off' } },
  },
});
