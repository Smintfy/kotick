import { defineReducerMachine } from 'kotick/reducer';

export type DownloadState = { status: 'idle' } | { status: 'downloading'; progress: number } | { status: 'done' };

type DownloadEvent = { type: 'START' } | { type: 'PROGRESS' } | { type: 'CANCEL' } | { type: 'RESET' };

// A reducer machine without fixtures.
// Thus, the panel greys out each state that the page did not go to, and the global styles try to change that row too.
export const downloadMachine = defineReducerMachine<DownloadState, DownloadEvent>()({
  id: 'download',
  discriminant: 'status',
  states: {
    idle: {
      on: { START: () => ({ status: 'downloading', progress: 0 }) },
    },
    downloading: {
      on: {
        PROGRESS: (state) => (state.progress >= 75 ? { status: 'done' } : { status: 'downloading', progress: state.progress + 25 }),
        CANCEL: () => ({ status: 'idle' }),
      },
      effect: (_state, send) => {
        const timer = setInterval(() => send({ type: 'PROGRESS' }), 500);

        return () => clearInterval(timer);
      },
    },
    done: {
      on: { RESET: () => ({ status: 'idle' }) },
    },
  },
});
