// The production project in vitest.config.ts runs this file with NODE_ENV set to 'production'.
// React has no act() in production.
// So the tests render with createRoot, wait for real time and click with element.click().

import * as xstateReact from '@xstate/react';
import { createRoot } from 'react-dom/client';
import { Konat } from 'konat';
import {
  connect,
  createActorContext,
  defineFixtures,
  shallowEqual,
  useActor,
  useActorRef,
  useMachine,
  useSelector,
} from 'konat/xstate';
import { expect, onTestFinished, test } from 'vitest';
import { createActor, setup } from 'xstate';
import { watchConsole } from './support/console';
import { freshId } from './support/panel';

type ToggleEvent = { type: 'TOGGLE' };

function createToggleMachine() {
  // SAFETY: XState reads the types of setup() only at compile time. It never reads this value.
  return setup({ types: { events: {} as ToggleEvent } }).createMachine({
    id: freshId('toggle'),
    initial: 'off',
    states: {
      off: { on: { TOGGLE: 'on' } },
      on: { on: { TOGGLE: 'off' } },
    },
  });
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

test('an app runs on @xstate/react alone: no overlay, shortcut, fixtures or storage', async () => {
  const globals = Reflect.ownKeys(globalThis);
  const machine = createToggleMachine();
  const loads: string[] = [];

  function Toggle() {
    const [snapshot, send] = useMachine(machine, { debug: { label: 'Toggle' } });

    return (
      <button type="button" onClick={() => send({ type: 'TOGGLE' })}>
        {String(snapshot.value)}
      </button>
    );
  }

  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  onTestFinished(() => {
    root.unmount();
    container.remove();
  });
  root.render(
    <>
      <Toggle />
      <Konat
        defaultOpen
        fixtures={() => {
          loads.push('fixtures');

          return [];
        }}
      />
    </>,
  );
  await settle();
  const loaded = document.body.innerHTML;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', altKey: true }));
  container.querySelector('button')?.click();
  await settle();
  window.dispatchEvent(new Event('pagehide'));

  expect({
    loaded,
    used: document.body.innerHTML,
    loads,
    sessionStorage: { ...sessionStorage },
    localStorage: { ...localStorage },
    added: Reflect.ownKeys(globalThis).filter((key) => !globals.includes(key)),
  }).toEqual({
    loaded: '<div><button type="button">off</button></div>',
    used: '<div><button type="button">on</button></div>',
    loads: [],
    sessionStorage: {},
    localStorage: {},
    added: [],
  });
});

test('konat/xstate is @xstate/react: the same hooks, a connect() that returns its actor, and fixtures without a check', () => {
  const output = watchConsole();
  const machine = createToggleMachine();
  const running = createActor(machine).start();
  onTestFinished(() => {
    running.stop();
  });

  // @ts-expect-error The types reject a typo in a leaf id, and development builds warn about it.
  const set = defineFixtures(machine, { offf: { context: {} } });
  expect({
    hooks: [
      useMachine === xstateReact.useMachine,
      useActor === xstateReact.useActor,
      useActorRef === xstateReact.useActorRef,
      createActorContext === xstateReact.createActorContext,
      useSelector === xstateReact.useSelector,
      shallowEqual === xstateReact.shallowEqual,
    ],
    connected: connect(running, { id: freshId('running'), label: 'Running' }) === running,
    set,
    output,
  }).toEqual({
    hooks: [true, true, true, true, true, true],
    connected: true,
    set: { machineId: machine.id, states: { offf: { context: {} } } },
    output: { warn: [], error: [] },
  });
});
