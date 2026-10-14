// connect() accepts any running machine actor, including one that isn't the root of its system, such as an invoked
// child reached through `system.get()`. Its handle should list only its own descendants (spec §10.2, R5): the actor
// system's inspection stream reports every actor in the system, so the root and the connected actor's siblings must
// not show up as its children.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createActor, createMachine, sendTo, setup, type Actor } from 'xstate';
import { connect } from '../../src/xstate';
import { flush, handlesOf, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

const authMachine = createMachine({
  id: 'auth',
  initial: 'signedOut',
  states: {
    signedOut: { on: { SIGN_IN: 'signedIn' } },
    signedIn: {},
  },
});

const settingsMachine = createMachine({
  id: 'settings',
  initial: 'closed',
  states: {
    closed: { on: { OPEN: 'open' } },
    open: {},
  },
});

/** Invokes auth (with a system id) and settings side by side; TOGGLE moves the root, OPEN_SETTINGS moves settings. */
const appMachine = setup({
  types: { events: {} as { type: 'TOGGLE' } | { type: 'OPEN_SETTINGS' } },
  actors: { auth: authMachine, settings: settingsMachine },
}).createMachine({
  id: 'app',
  invoke: [
    { id: 'auth', systemId: 'auth', src: 'auth' },
    { id: 'settings', src: 'settings' },
  ],
  initial: 'light',
  on: { OPEN_SETTINGS: { actions: sendTo('settings', { type: 'OPEN' }) } },
  states: {
    light: { on: { TOGGLE: 'dark' } },
    dark: { on: { TOGGLE: 'light' } },
  },
});

let app: Actor<typeof appMachine> | undefined;

beforeEach(() => {
  resetRegistry();
});

afterEach(() => {
  app?.stop();
  app = undefined;
});

describe('connect() on an actor that is not the root of its system', () => {
  async function connectAuth() {
    app = createActor(appMachine).start();
    const auth = app.system.get('auth');
    expect(auth?._parent).toBe(app);
    connect(auth, { id: 'auth' });
    await flush();
    return onlyHandle('auth');
  }

  test('lists only the connected actor before anything else in the system moves', async () => {
    await connectAuth();
    expect(registry().getSnapshot().machines.map(keyOf)).toEqual([keyOf(onlyHandle('auth'))]);
  });

  test("doesn't list the system's root as a child of the connected actor when the root transitions", async () => {
    const authHandle = await connectAuth();

    app!.send({ type: 'TOGGLE' });
    await flush();

    const appAsChild = handlesOf('app').map((handle) => `${keyOf(handle)} <- ${handle.parentKey ?? '(root)'}`);
    expect(appAsChild).toEqual([]);
    expect(registry().getSnapshot().machines.map(keyOf)).toEqual([keyOf(authHandle)]);
  });

  test("doesn't list the connected actor's siblings when they transition", async () => {
    const authHandle = await connectAuth();

    app!.send({ type: 'OPEN_SETTINGS' });
    await flush();

    const listed = registry()
      .getSnapshot()
      .machines.map((handle) => `${keyOf(handle)} <- ${handle.parentKey ?? '(root)'}`);
    expect(listed).toEqual([`${keyOf(authHandle)} <- (root)`]);
  });
});
