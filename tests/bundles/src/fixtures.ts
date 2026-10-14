import { defineFixtures } from 'state-viewer/xstate';
import { toggleMachine } from './toggle';

export default [defineFixtures(toggleMachine, { on: { context: { count: 1 } } })];
