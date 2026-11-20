import { defineReducerMachine } from 'konat/reducer';
import { type Account, canInvite, emptyAccount, type OnboardingEvent, saveWorkspace } from '@/demo/onboarding/account';

export type OnboardingState =
  | { step: 'profile'; account: Account }
  | { step: 'role'; account: Account }
  | { step: 'workspace'; account: Account }
  | { step: 'creating'; account: Account }
  | { step: 'error'; account: Account; error: string }
  | { step: 'invite'; account: Account }
  | { step: 'done'; account: Account };

/** The effect of creating sends the result of the request as one of these events. */
type WorkspaceEvent = { type: 'CREATED' } | { type: 'FAILED'; error: string };

export const initialOnboarding: OnboardingState = { step: 'profile', account: emptyAccount };

export const onboardingReducerMachine = defineReducerMachine<OnboardingState, OnboardingEvent | WorkspaceEvent>()({
  id: 'onboarding-reducer',
  discriminant: 'step',
  states: {
    profile: {
      on: {
        UPDATE_NAME: (state, event) => ({ step: 'profile', account: { ...state.account, name: event.name } }),
        NEXT: (state) => (state.account.name.trim() === '' ? state : { step: 'role', account: state.account }),
      },
    },
    role: {
      on: {
        SELECT_ROLE: (state, event) => ({ step: 'role', account: { ...state.account, role: event.role } }),
        BACK: (state) => ({ step: 'profile', account: state.account }),
        NEXT: (state) => (state.account.role === undefined ? state : { step: 'workspace', account: state.account }),
      },
    },
    workspace: {
      on: {
        UPDATE_WORKSPACE: (state, event) => ({ step: 'workspace', account: { ...state.account, workspace: event.workspace } }),
        CREATE_WORKSPACE: (state) =>
          state.account.workspace.trim() === '' ? state : { step: 'creating', account: state.account },
        BACK: (state) => ({ step: 'role', account: state.account }),
      },
    },
    creating: {
      on: {
        CREATED: (state) => ({ step: 'invite', account: state.account }),
        FAILED: (state, event) => ({ step: 'error', account: state.account, error: event.error }),
      },
      // The request runs in the machine, so a preview never blocks its result.
      effect: (state, send) => {
        void saveWorkspace(state.account.workspace).then(
          () => send({ type: 'CREATED' }),
          (error: Error) => send({ type: 'FAILED', error: error.message }),
        );
      },
    },
    error: {
      on: {
        UPDATE_WORKSPACE: (state, event) => ({ step: 'workspace', account: { ...state.account, workspace: event.workspace } }),
        BACK: (state) => ({ step: 'role', account: state.account }),
      },
    },
    invite: {
      on: {
        UPDATE_EMAIL: (state, event) => ({ step: 'invite', account: { ...state.account, email: event.email } }),
        ADD_INVITE: (state) =>
          canInvite(state.account)
            ? {
                step: 'invite',
                account: { ...state.account, invites: [...state.account.invites, state.account.email.trim()], email: '' },
              }
            : state,
        REMOVE_INVITE: (state, event) => ({
          step: 'invite',
          account: { ...state.account, invites: state.account.invites.filter((email) => email !== event.email) },
        }),
        SEND_INVITES: (state) => (state.account.invites.length === 0 ? state : { step: 'done', account: state.account }),
        SKIP: (state) => ({ step: 'done', account: state.account }),
      },
    },
    done: {},
  },
});
