// Context for the states that come after a slow request.
// dev-tools.tsx loads this file only in development, so production builds don't include it.
//
// The feedback machine is a reducer machine, and each of its fixtures is a whole state object.
// Both entries export defineFixtures, so this file imports the one of kotick/reducer with another name.

import { defineFixtures as defineReducerFixtures } from 'kotick/reducer';
import { defineFixtures } from 'kotick/xstate';
import { feedbackMachine } from '@/machines/feedback';
import { signupMachine } from '@/machines/signup';

export default [
  defineFixtures(signupMachine, {
    submitting: { context: { email: 'ada@example.org', error: null } },
    failed: { context: { email: 'ada@example.com', error: 'This address is already on the list.' } },
    subscribed: { context: { email: 'ada@example.org', error: null } },
  }),
  defineReducerFixtures(feedbackMachine, {
    sending: { status: 'sending', rating: 4, comment: 'The order came a day early.' },
    sent: { status: 'sent', rating: 4 },
  }),
];
