import { assign, createActor, fromPromise, setup } from 'xstate';
import { connect } from 'state-viewer/xstate';

type User = { name: string };

/** The time from sign-in to the `expired` state. */
export const SESSION_TTL = 5 * 60 * 1000;

const authenticate = fromPromise<User>(async () => {
  await new Promise((resolve) => setTimeout(resolve, 600));

  return { name: 'Ada Lovelace' };
});

export const sessionMachine = setup({
  types: {
    context: {} as { user: User | null },
    events: {} as { type: 'SIGN_IN' } | { type: 'SIGN_OUT' },
  },
  actors: { authenticate },
  delays: { ttl: SESSION_TTL },
}).createMachine({
  id: 'session',
  initial: 'signedIn',
  context: { user: { name: 'Ada Lovelace' } },
  states: {
    signedOut: {
      on: { SIGN_IN: 'signingIn' },
    },
    signingIn: {
      tags: ['busy'],
      invoke: {
        src: 'authenticate',
        onDone: { target: 'signedIn', actions: assign({ user: ({ event }) => event.output }) },
      },
    },
    signedIn: {
      after: { ttl: 'expired' },
      on: { SIGN_OUT: { target: 'signedOut', actions: assign({ user: null }) } },
    },
    expired: {
      description: 'Timed out; the user is kept so they can sign back in',
      on: {
        SIGN_IN: 'signingIn',
        SIGN_OUT: { target: 'signedOut', actions: assign({ user: null }) },
      },
    },
  },
});

// We make this actor at module level, not in React. Thus, it registers through connect() and not through a hook.
export const sessionActor = connect(createActor(sessionMachine).start(), { id: 'session' });
