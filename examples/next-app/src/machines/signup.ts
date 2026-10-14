import { assign, fromPromise, setup } from 'xstate';

/** The request fails for addresses at example.com. Thus, the failed state is easy to get to by hand. */
const subscribe = fromPromise<void, { email: string }>(async ({ input }) => {
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (input.email.endsWith('@example.com')) throw new Error('This address is already on the list.');
});

export const signupMachine = setup({
  types: {
    context: {} as { email: string; error: string | null },
    events: {} as { type: 'EDIT'; email: string } | { type: 'SUBMIT' } | { type: 'RESET' },
  },
  actors: { subscribe },
  guards: { validEmail: ({ context }) => /^\S+@\S+\.\S+$/.test(context.email) },
}).createMachine({
  id: 'signup',
  initial: 'editing',
  context: { email: '', error: null },
  states: {
    editing: {
      on: {
        EDIT: { actions: assign({ email: ({ event }) => event.email }) },
        SUBMIT: { guard: 'validEmail', target: 'submitting' },
      },
    },
    submitting: {
      tags: ['busy'],
      invoke: {
        src: 'subscribe',
        input: ({ context }) => ({ email: context.email }),
        onDone: 'subscribed',
        onError: { target: 'failed', actions: assign({ error: ({ event }) => (event.error as Error).message }) },
      },
    },
    failed: {
      on: {
        EDIT: { target: 'editing', actions: assign({ email: ({ event }) => event.email, error: null }) },
        SUBMIT: 'submitting',
      },
    },
    subscribed: {
      on: { RESET: { target: 'editing', actions: assign({ email: '', error: null }) } },
    },
  },
});
