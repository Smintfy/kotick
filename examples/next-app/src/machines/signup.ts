import { assign, fromPromise, setup } from 'xstate';

type SignupContext = { email: string; error: string | null };

type SignupEvent = { type: 'EDIT'; email: string } | { type: 'SUBMIT' } | { type: 'RESET' };

/** The request fails for addresses at example.com. Thus, the failed state is easy to get to by hand. */
const subscribe = fromPromise<void, { email: string }>(async ({ input }) => {
  await new Promise((resolve) => setTimeout(resolve, 800));

  if (input.email.endsWith('@example.com')) throw new Error('This address is already on the list.');
});

export const signupMachine = setup({
  // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
  types: {
    context: {} as SignupContext,
    events: {} as SignupEvent,
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
