// R28 and §10.7: production builds keep @xstate/react's hooks and drop the debugger. src/xstate.ts reads
// process.env.NODE_ENV when it's evaluated, so each test imports a fresh copy under the environment it needs.

import { act, fireEvent, render, screen } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createActor, fromPromise, setup } from 'xstate';
import { REGISTRY_KEY } from '../../src/core/registry';
import { flush, onlyHandle, registry, resetRegistry } from './helpers';

const toggleMachine = setup({}).createMachine({
  id: 'toggle',
  initial: 'off',
  states: {
    off: { on: { TOGGLE: 'on' } },
    on: { on: { TOGGLE: 'off' } },
  },
});

const originalNodeEnv = process.env.NODE_ENV;

/** A copy of state-viewer/xstate evaluated with NODE_ENV set to `nodeEnv`. */
async function importAdapter(nodeEnv: string) {
  process.env.NODE_ENV = nodeEnv;
  vi.resetModules();
  return import('../../src/xstate');
}

function registryCreated(): boolean {
  return REGISTRY_KEY in globalThis;
}

beforeEach(() => {
  resetRegistry();
});

afterEach(() => {
  // Assigning undefined would store the string "undefined".
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  vi.restoreAllMocks();
});

describe('in production', () => {
  test('the hooks are @xstate/react’s own functions', async () => {
    const adapter = await importAdapter('production');

    expect(adapter.useMachine).toBe(xstateReact.useMachine);
    expect(adapter.useActor).toBe(xstateReact.useActor);
    expect(adapter.useActorRef).toBe(xstateReact.useActorRef);
    expect(adapter.createActorContext).toBe(xstateReact.createActorContext);
    expect(adapter.useSelector).toBe(xstateReact.useSelector);
    expect(adapter.shallowEqual).toBe(xstateReact.shallowEqual);
  });

  test('connect returns the actor unchanged and registers nothing', async () => {
    const adapter = await importAdapter('production');
    const actor = createActor(toggleMachine).start();

    const connected = adapter.connect(actor, { id: 'app', label: 'App' });

    expect(connected).toBe(actor);
    connected.send({ type: 'TOGGLE' });
    expect(actor.getSnapshot().value).toBe('on');
    await flush();
    expect(registryCreated()).toBe(false);

    actor.stop();
  });

  test('connect returns any actor it is given unchanged', async () => {
    const adapter = await importAdapter('production');
    const stopped = createActor(toggleMachine);
    const promiseActor = createActor(fromPromise(async () => 'done'));

    expect(adapter.connect(stopped)).toBe(stopped);
    expect(adapter.connect(promiseActor, { id: 'promise' })).toBe(promiseActor);
    expect(registryCreated()).toBe(false);
  });

  test('hooks given debug options work as @xstate/react’s and register nothing', async () => {
    const adapter = await importAdapter('production');

    function Toggle() {
      const [snapshot, send] = adapter.useMachine(toggleMachine, { debug: { id: 'toggle-debug', label: 'Toggle' } });
      return createElement('button', { type: 'button', onClick: () => send({ type: 'TOGGLE' }) }, String(snapshot.value));
    }

    render(createElement(Toggle));
    await flush();
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('off');

    fireEvent.click(button);
    expect(button.textContent).toBe('on');
    await flush();
    expect(registryCreated()).toBe(false);
  });

  test('a context Provider given debug options works as @xstate/react’s and registers nothing', async () => {
    const adapter = await importAdapter('production');
    const ToggleContext = adapter.createActorContext(toggleMachine, { debug: { id: 'toggle-context' } });

    function Value() {
      const value = ToggleContext.useSelector((snapshot) => String(snapshot.value));
      const actorRef = ToggleContext.useActorRef();
      return createElement('button', { type: 'button', onClick: () => actorRef.send({ type: 'TOGGLE' }) }, value);
    }

    render(
      createElement(ToggleContext.Provider, {
        options: { debug: { label: 'Provided' } },
        children: createElement(Value),
      }),
    );
    await flush();
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('off');

    fireEvent.click(button);
    expect(button.textContent).toBe('on');
    await flush();
    expect(registryCreated()).toBe(false);
  });

  test('defineFixtures still returns the set but skips the unknown-leaf warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = await importAdapter('production');

    const set = adapter.defineFixtures(toggleMachine, { offf: { context: {} } } as never);

    expect(set).toEqual({ machineId: 'toggle', source: toggleMachine.config, states: { offf: { context: {} } } });
    // Fixtures match on the config object itself, so it has to be the same one, not a copy.
    expect(set.source).toBe(toggleMachine.config);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('outside production', () => {
  test.each(['test', 'development'])('with NODE_ENV=%s the hooks are the adapter’s, not @xstate/react’s', async (env) => {
    const adapter = await importAdapter(env);

    expect(adapter.useMachine).not.toBe(xstateReact.useMachine);
    expect(adapter.useActor).not.toBe(xstateReact.useActor);
    expect(adapter.useActorRef).not.toBe(xstateReact.useActorRef);
    expect(adapter.createActorContext).not.toBe(xstateReact.createActorContext);
    // These two are re-exports in every build.
    expect(adapter.useSelector).toBe(xstateReact.useSelector);
    expect(adapter.shallowEqual).toBe(xstateReact.shallowEqual);
  });

  test('connect returns a proxy and registers the actor', async () => {
    const adapter = await importAdapter('development');
    const actor = createActor(toggleMachine).start();

    const connected = adapter.connect(actor, { id: 'app' });
    // Instance ids come from the page-wide counter, not the actor's sessionId: connect() draws the latest one.
    const drawnId = String((globalThis as Record<string, unknown>).__STATE_VIEWER_LAST_INSTANCE__);
    await flush();

    expect(connected).not.toBe(actor);
    const handle = onlyHandle('app');
    expect(handle.instanceId).toMatch(/^\d+$/);
    expect(handle.instanceId).toBe(drawnId);
    expect(handle.source).toBe(toggleMachine.config);
    // The handle reads this actor: an event sent through the proxy shows in its leaves.
    act(() => connected.send({ type: 'TOGGLE' }));
    expect(actor.getSnapshot().value).toBe('on');
    expect(handle.getActiveLeaves()).toEqual(['on']);

    act(() => actor.stop());
    await flush();
    expect(registry().getSnapshot().machines).toEqual([]);
  });

  test('hooks register their actor', async () => {
    const adapter = await importAdapter('development');

    function Toggle() {
      const [snapshot] = adapter.useMachine(toggleMachine, { debug: { id: 'toggle-debug' } });
      return createElement('span', null, String(snapshot.value));
    }

    const { unmount } = render(createElement(Toggle));
    await flush();
    expect(onlyHandle('toggle-debug').machineId).toBe('toggle-debug');

    unmount();
    await flush();
    expect(registry().getSnapshot().machines).toEqual([]);
  });
});
