import { setup } from 'xstate';

type PlayerContext = { track: string };

type PlayerEvent = { type: 'PLAY' } | { type: 'PAUSE' } | { type: 'STOP' } | { type: 'FAST' } | { type: 'NORMAL' };

// A small machine with a nested state, a tag, and a description.
// Thus, the state tree of the panel shows each type of row.
export const playerMachine = setup({
  // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
  types: {
    context: {} as PlayerContext,
    events: {} as PlayerEvent,
  },
}).createMachine({
  id: 'player',
  initial: 'stopped',
  context: { track: 'Overture' },
  states: {
    stopped: {
      on: { PLAY: 'playing' },
    },
    playing: {
      tags: ['busy'],
      initial: 'normal',
      on: { PAUSE: 'paused', STOP: 'stopped' },
      states: {
        normal: { on: { FAST: 'fast' } },
        fast: { description: 'Two times the normal speed', on: { NORMAL: 'normal' } },
      },
    },
    paused: {
      on: { PLAY: 'playing', STOP: 'stopped' },
    },
  },
});
