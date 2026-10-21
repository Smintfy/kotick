import { assign, fromCallback, setup, type EventObject } from 'xstate';

export type UploadInput = {
  fileName: string;
  /** The size in bytes. */
  size: number;
  /**
   * If the first transfer gets to this progress in %, an error occurs.
   * This simulates a connection that is not stable.
   */
  failAt?: number;
};

type UploadContext = UploadInput & {
  progress: number;
  attempts: number;
  error?: string;
};

type UploadEvent =
  | { type: 'START' }
  | { type: 'CANCEL' }
  | { type: 'RETRY' }
  | { type: 'PROGRESS'; progress: number }
  | { type: 'COMPLETE' }
  | { type: 'FAIL'; error: string };

// A transfer for the example app. The progress increases by 20% each 150 ms.
// If `failAt` has a value, an error occurs at that progress.
const transfer = fromCallback<EventObject, { failAt?: number }>(({ sendBack, input }) => {
  let progress = 0;

  const timer = setInterval(() => {
    progress += 20;

    if (input.failAt !== undefined && progress >= input.failAt) {
      sendBack({ type: 'FAIL', error: 'Connection lost' });
    } else if (progress >= 100) {
      sendBack({ type: 'COMPLETE' });
    } else {
      sendBack({ type: 'PROGRESS', progress });
    }
  }, 150);

  return () => clearInterval(timer);
});

export const uploadMachine = setup({
  // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
  types: {
    context: {} as UploadContext,
    events: {} as UploadEvent,
    input: {} as UploadInput,
  },
  actors: { transfer },
}).createMachine({
  id: 'upload',
  initial: 'queued',
  context: ({ input }) => ({ ...input, progress: 0, attempts: 0 }),
  states: {
    queued: {
      on: { START: 'uploading' },
    },
    uploading: {
      tags: ['busy'],
      entry: assign({
        progress: 0,
        error: undefined,
        attempts: ({ context }) => context.attempts + 1,
      }),
      invoke: {
        src: 'transfer',
        // An error occurs only in the first transfer. Thus, the transfer completes after "Retry".
        input: ({ context }) => ({ failAt: context.attempts === 1 ? context.failAt : undefined }),
      },
      on: {
        PROGRESS: { actions: assign({ progress: ({ event }) => event.progress }) },
        COMPLETE: { target: 'done', actions: assign({ progress: 100 }) },
        FAIL: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) },
        CANCEL: { target: 'queued', actions: assign({ progress: 0 }) },
      },
    },
    failed: {
      on: { RETRY: 'uploading' },
    },
    done: { type: 'final' },
  },
});
