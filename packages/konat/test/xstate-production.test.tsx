// The xstate-production project in vitest.config.ts runs this file on XState's production build.
// A bundler without the development condition, such as esbuild, gives an app that build in development too.

import { connect } from 'konat/xstate';
import { describe, expect, onTestFinished, test } from 'vitest';
import { createActor, createMachine, type AnyActorRef } from 'xstate';
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

describe('an actor that connects itself while XState creates it', () => {
  test('has no snapshot yet, comes back unchanged, is not listed, and starts', async () => {
    await mount(null);
    const seen: { hasSnapshot: boolean; returned: AnyActorRef }[] = [];

    const machine = createMachine({
      id: freshId('self-connected'),
      context: ({ self }) => {
        seen.push({ hasSnapshot: self.getSnapshot() !== undefined, returned: connect(self) });

        return {};
      },
    });

    const actor = createActor(machine).start();
    onTestFinished(() => {
      actor.stop();
    });
    await flush();

    expect({
      seen: seen.map(({ hasSnapshot, returned }) => ({ hasSnapshot, same: returned === actor })),
      status: actor.getSnapshot().status,
      machines: await machines(),
    }).toEqual({ seen: [{ hasSnapshot: false, same: true }], status: 'active', machines: [] });
  });
});
