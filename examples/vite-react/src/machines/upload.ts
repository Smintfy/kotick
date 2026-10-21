import { assign, fromCallback, setup, type EventObject } from 'xstate';

export type UploadInput = {
  fileName: string;
  sizeBytes: number;
  /** Simulates a connection that is not stable. */
  firstAttemptFailsAtPercent?: number;
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
const transfer = fromCallback<EventObject, { failsAtPercent?: number }>(({ sendBack, input }) => {
  let progress = 0;

  const timer = setInterval(() => {
    progress += 20;

    if (input.failsAtPercent !== undefined && progress >= input.failsAtPercent) {
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
        input: ({ context }) => ({
          failsAtPercent: context.attempts === 1 ? context.firstAttemptFailsAtPercent : undefined,
        }),
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
