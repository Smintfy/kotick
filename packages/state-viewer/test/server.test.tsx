// @vitest-environment node

import { renderToString } from 'react-dom/server';
import { StateViewer } from 'state-viewer';
import { connect, createActorContext, useActor, useActorRef, useMachine, useSelector } from 'state-viewer/xstate';
import { expect, test } from 'vitest';
import { createActor, setup } from 'xstate';
import { watchConsole } from './support/console';

type ToggleEvent = { type: 'TOGGLE' };

// The server has no page registry, so the tests in this file can share a machine id.
// SAFETY: XState reads the types of setup() only at compile time. It never reads this value.
const toggleMachine = setup({ types: { events: {} as ToggleEvent } }).createMachine({
  id: 'toggle',
  initial: 'off',
  states: { off: { on: { TOGGLE: 'on' } }, on: { on: { TOGGLE: 'off' } } },
});

// Read before any test runs, so a registry that an earlier test put on globalThis also fails a later test.
const globalsAtLoad = Reflect.ownKeys(globalThis);

/**
 * The keys added to globalThis since this file loaded, except keys that hold a number.
 * The hooks and connect() count instances in a number on globalThis, also on the server.
 * A registry is an object, so it shows here.
 */
function objectsAdded(): PropertyKey[] {
  return Reflect.ownKeys(globalThis).filter(
    (key) => !globalsAtLoad.includes(key) && !isCount(Object.getOwnPropertyDescriptor(globalThis, key)?.value),
  );
}

function isCount(value: unknown): value is number {
  return typeof value === 'number';
}

test('renders nothing, loads no fixtures, and leaves globalThis as it was', () => {
  const output = watchConsole();
  const loads: string[] = [];
  const globals = Reflect.ownKeys(globalThis);

  const html = renderToString(
    <StateViewer
      defaultOpen
      fixtures={() => {
        loads.push('fixtures');

        return [];
      }}
    />,
  );

  const added = Reflect.ownKeys(globalThis).filter((key) => !globals.includes(key));
  expect({ html, loads, added, output }).toEqual({ html: '', loads: [], added: [], output: { warn: [], error: [] } });
});

test('the hooks render the initial state of the machine, and put no registry on globalThis', () => {
  const output = watchConsole();
  const ToggleContext = createActorContext(toggleMachine);

  function FromContext() {
    const value = ToggleContext.useSelector((snapshot) => snapshot.value);

    return <li>{`createActorContext: ${value}`}</li>;
  }

  function Toggles() {
    const [machine] = useMachine(toggleMachine);
    const [actor] = useActor(toggleMachine);
    const selected = useSelector(useActorRef(toggleMachine), (snapshot) => snapshot.value);

    return (
      <>
        <li>{`useMachine: ${machine.value}`}</li>
        <li>{`useActor: ${actor.value}`}</li>
        <li>{`useActorRef: ${selected}`}</li>
      </>
    );
  }

  const html = renderToString(
    <ul>
      <Toggles />
      <ToggleContext.Provider>
        <FromContext />
      </ToggleContext.Provider>
      <StateViewer defaultOpen />
    </ul>,
  );

  expect({ html, added: objectsAdded(), output }).toEqual({
    html: '<ul><li>useMachine: off</li><li>useActor: off</li><li>useActorRef: off</li><li>createActorContext: off</li></ul>',
    added: [],
    output: { warn: [], error: [] },
  });
});

test('connect() gives an actor that takes events, as nothing is previewed, and puts no registry on globalThis', () => {
  const output = watchConsole();
  const actor = connect(createActor(toggleMachine).start());

  function Toggle() {
    const value = useSelector(actor, (snapshot) => snapshot.value);

    return <p>{`connect: ${value}`}</p>;
  }

  actor.send({ type: 'TOGGLE' });
  const html = [renderToString(<Toggle />)];
  actor.send({ type: 'TOGGLE' });
  html.push(renderToString(<Toggle />));
  actor.stop();
  expect({ html, added: objectsAdded(), output }).toEqual({
    html: ['<p>connect: on</p>', '<p>connect: off</p>'],
    added: [],
    output: { warn: [], error: [] },
  });
});
