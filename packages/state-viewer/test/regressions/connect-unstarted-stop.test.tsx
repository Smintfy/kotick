// connect() follows the actor's lifetime: an actor connected before it starts (`connect(createActor(m))`, which the
// proxy's start() supports) and then stopped through the proxy without ever starting leaves the registry too. Stopping
// the actor itself before start goes unnoticed, since XState reports nothing then.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createActor, createMachine } from 'xstate';
import { connect } from '../../src/xstate';
import { flush, handlesOf, resetRegistry } from '../xstate/helpers';

const toggleMachine = createMachine({
  id: 'toggle',
  initial: 'off',
  states: { off: { on: { TOGGLE: 'on' } }, on: { on: { TOGGLE: 'off' } } },
});

function registeredInstances(): string[] {
  return handlesOf('toggle').map((handle) => handle.instanceId);
}

beforeEach(() => {
  resetRegistry();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

describe('connect() with an actor stopped before it started', () => {
  test('unregisters when stopped through the proxy before start', async () => {
    const proxy = connect(createActor(toggleMachine), { id: 'toggle' });
    await flush();

    proxy.stop();
    await flush();

    expect(registeredInstances()).toEqual([]);
  });
});
