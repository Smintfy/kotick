// The production project in vitest.config.ts runs this file with NODE_ENV set to 'production'.
// React has no act() in production.
// So the tests render with createRoot, wait for real time and click with element.click().

import * as xstateReact from '@xstate/react';
import { createRoot } from 'react-dom/client';
import { StateViewer } from 'state-viewer';
import {
  connect,
  createActorContext,
  defineFixtures,
  shallowEqual,
  useActor,
  useActorRef,
  useMachine,
  useSelector,
} from 'state-viewer/xstate';
import { describe, expect, onTestFinished, test } from 'vitest';
import { createActor, fromPromise, setup } from 'xstate';
import { watchConsole } from './support/console';
import { freshId } from './support/panel';

function createToggleMachine() {
  return setup({ types: { events: {} as { type: 'TOGGLE' } } }).createMachine({
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

test('an app runs on @xstate/react alone: no overlay, shortcut, deep link, fixtures or storage', async () => {
  const globals = Reflect.ownKeys(globalThis);
  const hookMachine = createToggleMachine();
  const contextMachine = createToggleMachine();
  const connectedMachine = createToggleMachine();
  const connected = connect(createActor(connectedMachine).start(), { label: 'Connected' });
  onTestFinished(() => {
    connected.stop();
  });
  const ToggleContext = createActorContext(contextMachine, { debug: { label: 'Context' } });
  const loads: string[] = [];
  const link = [hookMachine.id, contextMachine.id, connectedMachine.id].map((id) => `${id}:on`).join(',');
  window.history.replaceState(null, '', `/?debug-state=${link}`);

  function HookToggle() {
    const [snapshot, send] = useMachine(hookMachine, { debug: { label: 'Hook' } });

    return (
      <button type="button" onClick={() => send({ type: 'TOGGLE' })}>
        hook {String(snapshot.value)}
      </button>
    );
  }

  function ContextToggle() {
    const value = ToggleContext.useSelector((snapshot) => String(snapshot.value));
    const actorRef = ToggleContext.useActorRef();

    return (
      <button type="button" onClick={() => actorRef.send({ type: 'TOGGLE' })}>
        context {value}
      </button>
    );
  }

  function ConnectedToggle() {
    const value = useSelector(connected, (snapshot) => String(snapshot.value));

    return (
      <button type="button" onClick={() => connected.send({ type: 'TOGGLE' })}>
        connected {value}
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
      <HookToggle />
      <ToggleContext.Provider options={{ debug: { label: 'Provided' } }}>
        <ContextToggle />
      </ToggleContext.Provider>
      <ConnectedToggle />
      <StateViewer
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

  for (const button of container.querySelectorAll('button')) button.click();
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
    loaded:
      '<div><button type="button">hook off</button><button type="button">context off</button>' +
      '<button type="button">connected off</button></div>',
    used:
      '<div><button type="button">hook on</button><button type="button">context on</button>' +
      '<button type="button">connected on</button></div>',
    loads: [],
    sessionStorage: {},
    localStorage: {},
    added: [],
  });
});

describe('state-viewer/xstate', () => {
  test('each hook is the @xstate/react hook of the same name', () => {
    expect({
      useMachine: useMachine === xstateReact.useMachine,
      useActor: useActor === xstateReact.useActor,
      useActorRef: useActorRef === xstateReact.useActorRef,
      createActorContext: createActorContext === xstateReact.createActorContext,
      useSelector: useSelector === xstateReact.useSelector,
      shallowEqual: shallowEqual === xstateReact.shallowEqual,
    }).toEqual({
      useMachine: true,
      useActor: true,
      useActorRef: true,
      createActorContext: true,
      useSelector: true,
      shallowEqual: true,
    });
  });

  test('connect returns the actor it is given', () => {
    const running = createActor(createToggleMachine()).start();
    onTestFinished(() => {
      running.stop();
    });
    const unstarted = createActor(createToggleMachine());
    const promise = createActor(fromPromise(async () => 'done'));

    expect({
      running: connect(running, { id: freshId('running'), label: 'Running' }) === running,
      unstarted: connect(unstarted) === unstarted,
      promise: connect(promise, { id: freshId('promise') }) === promise,
    }).toEqual({ running: true, unstarted: true, promise: true });
  });

  test('defineFixtures returns its set, and does not warn about a leaf the machine lacks', () => {
    const output = watchConsole();
    const machine = createToggleMachine();

    // @ts-expect-error The types reject a typo in a leaf id, and development builds warn about it.
    const set = defineFixtures(machine, { offf: { context: {} } });
    expect({ set, output }).toEqual({
      set: { machineId: machine.id, source: machine.config, states: { offf: { context: {} } } },
      output: { warn: [], error: [] },
    });
  });
});
