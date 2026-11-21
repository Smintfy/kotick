import { type CompleteFixtures, defineFixtures } from 'kotick/reducer';
import { type Account, emptyAccount, takenWorkspace } from '@/demo/onboarding/account';
import { onboardingReducerMachine } from '@/demo/onboarding/reducer/machine';

const profile: Account = { ...emptyAccount, name: 'Ada Lovelace' };

const withRole: Account = { ...profile, role: 'engineering' };

const withWorkspace: Account = { ...withRole, workspace: 'Analytical Engines' };

export const onboardingReducerFixtures = defineFixtures(onboardingReducerMachine, {
  profile: { step: 'profile', account: profile },
  role: { step: 'role', account: withRole },
  workspace: { step: 'workspace', account: withRole },
  creatingWorkspace: { step: 'creatingWorkspace', account: withWorkspace },
  workspaceFailed: { step: 'workspaceFailed', account: { ...withRole, workspace: takenWorkspace }, error: `The name ${takenWorkspace} is taken` },
  invite: { step: 'invite', account: { ...withWorkspace, email: 'mary@example.com', invites: ['charles@example.com'] } },
  done: { step: 'done', account: { ...withWorkspace, invites: ['charles@example.com', 'mary@example.com'] } },
} satisfies CompleteFixtures<typeof onboardingReducerMachine>);
