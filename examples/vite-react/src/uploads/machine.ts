import { assign, fromCallback, setup, type EventObject } from 'xstate';

export type UploadInput = {
  fileName: string;
  /** In bytes. */
  size: number;
  /** Progress percentage at which the first attempt fails, to simulate a flaky connection. */
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

// Fake transfer: 20% every 150 ms, failing at `failAt` when it's set.
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
        // Only the first attempt fails, so Retry succeeds.
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
