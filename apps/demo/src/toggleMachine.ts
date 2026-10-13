import { setup } from 'xstate';

// Smoke test for the workspace link. Replaced by the Milestone 0 demo machines.
export const toggleMachine = setup({}).createMachine({
  id: 'toggle',
  initial: 'off',
  states: {
    off: { on: { TOGGLE: 'on' } },
    on: { on: { TOGGLE: 'off' } },
  },
});
