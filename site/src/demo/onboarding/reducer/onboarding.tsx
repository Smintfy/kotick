'use client';

import { useMachineReducer } from 'kotick/reducer';
import { Done, InviteStep, ProfileStep, RoleStep, WorkspaceStep } from '@/components/demo/onboarding-steps';
import { canInvite } from '@/demo/onboarding/account';
import { initialOnboarding, onboardingReducerMachine } from '@/demo/onboarding/reducer/machine';

export function Onboarding() {
  const [state, dispatch] = useMachineReducer(onboardingReducerMachine, initialOnboarding);
  const { account } = state;

  switch (state.step) {
    case 'profile':
      return <ProfileStep account={account} canNext={account.name.trim() !== ''} send={dispatch} />;
    case 'role':
      return <RoleStep account={account} canNext={account.role !== undefined} send={dispatch} />;
    case 'workspace':
    case 'creatingWorkspace':
    case 'workspaceFailed':
      return (
        <WorkspaceStep
          account={account}
          busy={state.step === 'creatingWorkspace'}
          failed={state.step === 'workspaceFailed'}
          error={state.step === 'workspaceFailed' ? state.error : undefined}
          canBack={state.step !== 'creatingWorkspace'}
          canCreate={state.step === 'workspace' && account.workspace.trim() !== ''}
          send={dispatch}
        />
      );
    case 'invite':
      return (
        <InviteStep account={account} canAdd={canInvite(account)} canSend={account.invites.length > 0} send={dispatch} />
      );
    case 'done':
      return <Done account={account} />;
  }
}
