import { setup } from 'xstate';
import { createActorContext } from 'state-viewer/xstate';

type PreferencesEvent = { type: 'TOGGLE_THEME' } | { type: 'DAILY' } | { type: 'WEEKLY' } | { type: 'OFF' };

// Import this file only from client components.
// state-viewer/xstate is a client module, so server components can't call createActorContext.

export const preferencesMachine = setup({
  // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
  types: {
    events: {} as PreferencesEvent,
  },
}).createMachine({
  id: 'preferences',
  type: 'parallel',
  states: {
    theme: {
      initial: 'light',
      states: {
        light: { on: { TOGGLE_THEME: 'dark' } },
        dark: { on: { TOGGLE_THEME: 'light' } },
      },
    },
    digest: {
      initial: 'weekly',
      states: { daily: {}, weekly: {}, off: {} },
      on: { DAILY: '.daily', WEEKLY: '.weekly', OFF: '.off' },
    },
  },
});

/** The provider in Preferences.tsx creates the actor. The components in it read the actor with useSelector. */
export const PreferencesContext = createActorContext(preferencesMachine);
