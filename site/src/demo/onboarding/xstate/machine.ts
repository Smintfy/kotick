import { assign, fromPromise, setup } from 'xstate';
import { type Account, canInvite, emptyAccount, type OnboardingEvent, saveWorkspace } from '@/demo/onboarding/account';

export type OnboardingContext = Account & { error?: string };

const createWorkspace = fromPromise<void, { workspace: string }>(({ input }) => saveWorkspace(input.workspace));

export const onboardingMachine = setup({
  // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
  types: {
    context: {} as OnboardingContext,
    events: {} as OnboardingEvent,
  },
  actors: { createWorkspace },
  guards: {
    hasName: ({ context }) => context.name.trim() !== '',
    hasRole: ({ context }) => context.role !== undefined,
    hasWorkspace: ({ context }) => context.workspace.trim() !== '',
    canInvite: ({ context }) => canInvite(context),
    hasInvites: ({ context }) => context.invites.length > 0,
  },
}).createMachine({
  id: 'onboarding-xstate',
  initial: 'profile',
  context: emptyAccount,
  states: {
    profile: {
      on: {
        UPDATE_NAME: { actions: assign({ name: ({ event }) => event.name }) },
        NEXT: { guard: 'hasName', target: 'role' },
      },
    },
    role: {
      on: {
        SELECT_ROLE: { actions: assign({ role: ({ event }) => event.role }) },
        BACK: 'profile',
        NEXT: { guard: 'hasRole', target: 'workspace' },
      },
    },
    workspace: {
      initial: 'editing',
      states: {
        editing: {
          on: {
            UPDATE_WORKSPACE: { actions: assign({ workspace: ({ event }) => event.workspace }) },
            CREATE_WORKSPACE: { guard: 'hasWorkspace', target: 'creating' },
            BACK: '#onboarding-xstate.role',
          },
        },
        creating: {
          tags: ['busy'],
          invoke: {
            src: 'createWorkspace',
            input: ({ context }) => ({ workspace: context.workspace }),
            onDone: '#onboarding-xstate.invite',
            onError: {
              target: 'error',
              actions: assign({ error: ({ event }) => (event.error instanceof Error ? event.error.message : 'Could not create the workspace') }),
            },
          },
        },
        error: {
          on: {
            UPDATE_WORKSPACE: {
              target: 'editing',
              actions: assign({ workspace: ({ event }) => event.workspace, error: undefined }),
            },
            BACK: '#onboarding-xstate.role',
          },
        },
      },
    },
    invite: {
      on: {
        UPDATE_EMAIL: { actions: assign({ email: ({ event }) => event.email }) },
        ADD_INVITE: {
          guard: 'canInvite',
          actions: assign({ invites: ({ context }) => [...context.invites, context.email.trim()], email: '' }),
        },
        REMOVE_INVITE: {
          actions: assign({ invites: ({ context, event }) => context.invites.filter((email) => email !== event.email) }),
        },
        SEND_INVITES: { guard: 'hasInvites', target: 'done' },
        SKIP: 'done',
      },
    },
    done: { type: 'final' },
  },
});
