import { defineFixtures as defineReducerFixtures } from 'konat/reducer';
import { defineFixtures } from 'konat/xstate';
import { toggleReducerMachine } from './reducer-machine';
import { toggleMachine } from './toggle';

// The React Router build loads this file with no NODE_ENV check, so its production build has both helpers.
export default [
  defineFixtures(toggleMachine, { on: { context: { count: 1 } } }),
  defineReducerFixtures(toggleReducerMachine, { on: { status: 'on', count: 1 } }),
];
