import { defineFixtures } from 'konat/xstate';
import { assign, fromPromise, setup } from 'xstate';

export type Role = 'design' | 'engineering' | 'product' | 'other';

export type OnboardingContext = {
  name: string;
  role?: Role;
  workspace: string;
  email: string;
  invites: string[];
  error?: string;
};

export type OnboardingEvent =
  | { type: 'UPDATE_NAME'; name: string }
  | { type: 'SELECT_ROLE'; role: Role }
  | { type: 'UPDATE_WORKSPACE'; workspace: string }
  | { type: 'CREATE_WORKSPACE' }
  | { type: 'UPDATE_EMAIL'; email: string }
  | { type: 'ADD_INVITE' }
  | { type: 'REMOVE_INVITE'; email: string }
  | { type: 'SEND_INVITES' }
  | { type: 'SKIP' }
  | { type: 'NEXT' }
  | { type: 'BACK' };

export const takenWorkspace = 'Acme';

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const createWorkspace = fromPromise<void, { workspace: string }>(async ({ input }) => {
  await new Promise((resolve) => setTimeout(resolve, 800));

  if (input.workspace.trim().toLowerCase() === takenWorkspace.toLowerCase()) {
    throw new Error(`The name ${input.workspace.trim()} is taken`);
  }
});

const empty: OnboardingContext = { name: '', workspace: '', email: '', invites: [] };

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
    canInvite: ({ context }) => isEmail(context.email) && !context.invites.includes(context.email.trim()),
    hasInvites: ({ context }) => context.invites.length > 0,
  },
}).createMachine({
  id: 'onboarding',
  initial: 'profile',
  context: empty,
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
            BACK: '#onboarding.role',
          },
        },
        creating: {
          tags: ['busy'],
          invoke: {
            src: 'createWorkspace',
            input: ({ context }) => ({ workspace: context.workspace }),
            onDone: '#onboarding.invite',
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
            BACK: '#onboarding.role',
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

const profile: OnboardingContext = { ...empty, name: 'Ada Lovelace' };

const withRole: OnboardingContext = { ...profile, role: 'engineering' };

const withWorkspace: OnboardingContext = { ...withRole, workspace: 'Analytical Engines' };

export const onboardingFixtures = [
  defineFixtures(onboardingMachine, {
    profile: { context: empty },
    role: { context: profile },
    'workspace.editing': { context: withRole },
    'workspace.creating': { context: withWorkspace },
    'workspace.error': { context: { ...withRole, workspace: takenWorkspace, error: `The name ${takenWorkspace} is taken` } },
    invite: { context: { ...withWorkspace, invites: ['charles@example.com'] } },
    done: { context: { ...withWorkspace, invites: ['charles@example.com', 'mary@example.com'] } },
  }),
];
