// The xstate-production project in vitest.config.ts runs this file on XState's production build.

import { connect } from 'shiru/xstate';
import { expect, onTestFinished, test } from 'vitest';
import { createActor, createMachine } from 'xstate';
import { mount } from './support/app';
import { flush, freshId, machines } from './support/panel';

test('a connected actor is listed, as on the development build', async () => {
  await mount(null);
  const machine = createMachine({ id: freshId('toggle'), initial: 'off', states: { off: {}, on: {} } });
  const actor = connect(createActor(machine).start());
  onTestFinished(() => {
    actor.stop();
  });
  await flush();

  expect(await machines()).toEqual([machine.id]);
});
