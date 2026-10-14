// Context for the signup states that come after a slow request.
// DevTools.tsx loads this file only in development, so production builds don't include it.

import { defineFixtures } from 'state-viewer/xstate';
import { signupMachine } from '@/machines/signup';

export default [
  defineFixtures(signupMachine, {
    submitting: { context: { email: 'ada@example.org', error: null } },
    failed: { context: { email: 'ada@example.com', error: 'This address is already on the list.' } },
    subscribed: { context: { email: 'ada@example.org', error: null } },
  }),
];
