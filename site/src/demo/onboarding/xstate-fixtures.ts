import { defineFixtures } from 'konat/xstate';
import { emptyAccount, takenWorkspace } from '@/demo/onboarding/account';
import { type OnboardingContext, onboardingMachine } from '@/demo/onboarding/xstate-machine';

const profile: OnboardingContext = { ...emptyAccount, name: 'Ada Lovelace' };

const withRole: OnboardingContext = { ...profile, role: 'engineering' };

const withWorkspace: OnboardingContext = { ...withRole, workspace: 'Analytical Engines' };

export const onboardingFixtures = [
  defineFixtures(onboardingMachine, {
    profile: { context: profile },
    role: { context: withRole },
    'workspace.editing': { context: withRole },
    'workspace.creating': { context: withWorkspace },
    'workspace.error': { context: { ...withRole, workspace: takenWorkspace, error: `The name ${takenWorkspace} is taken` } },
    invite: { context: { ...withWorkspace, email: 'mary@example.com', invites: ['charles@example.com'] } },
    done: { context: { ...withWorkspace, invites: ['charles@example.com', 'mary@example.com'] } },
  }),
];
