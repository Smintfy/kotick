'use client';

import { useMachine } from 'shiru/xstate';
import { Done, InviteStep, ProfileStep, RoleStep, WorkspaceStep } from '@/components/demo/onboarding-steps';
import { onboardingMachine } from '@/demo/onboarding/xstate/machine';

export function Onboarding() {
  const [snapshot, send] = useMachine(onboardingMachine);
  const account = snapshot.context;

  if (snapshot.matches('profile')) return <ProfileStep account={account} canNext={snapshot.can({ type: 'NEXT' })} send={send} />;

  if (snapshot.matches('role')) return <RoleStep account={account} canNext={snapshot.can({ type: 'NEXT' })} send={send} />;

  if (snapshot.matches('workspace')) {
    return (
      <WorkspaceStep
        account={account}
        busy={snapshot.hasTag('busy')}
        failed={snapshot.matches({ workspace: 'error' })}
        error={account.error}
        canBack={snapshot.can({ type: 'BACK' })}
        canCreate={snapshot.can({ type: 'CREATE_WORKSPACE' })}
        send={send}
      />
    );
  }

  if (snapshot.matches('invite')) {
    return (
      <InviteStep
        account={account}
        canAdd={snapshot.can({ type: 'ADD_INVITE' })}
        canSend={snapshot.can({ type: 'SEND_INVITES' })}
        send={send}
      />
    );
  }

  return <Done account={account} />;
}
