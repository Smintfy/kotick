// @vitest-environment node

import { renderToString } from 'react-dom/server';
import { Konat } from 'konat';
import { connect, createActorContext, useActor, useActorRef, useMachine, useSelector } from 'konat/xstate';
import { expect, test } from 'vitest';
import { createActor, setup } from 'xstate';
import { watchConsole } from './support/console';

type ToggleEvent = { type: 'TOGGLE' };

// The server has no page registry, so every hook can run the same machine id.
// SAFETY: XState reads the types of setup() only at compile time. It never reads this value.
const toggleMachine = setup({ types: { events: {} as ToggleEvent } }).createMachine({
  id: 'toggle',
  initial: 'off',
  states: { off: { on: { TOGGLE: 'on' } }, on: { on: { TOGGLE: 'off' } } },
});

// Read when the file loads, before the test renders.
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

test('the overlay renders nothing, the hooks and connect() render the state, and no registry goes on globalThis', () => {
  const output = watchConsole();
  const loads: string[] = [];
  const ToggleContext = createActorContext(toggleMachine);
  const connected = connect(createActor(toggleMachine).start());
  connected.send({ type: 'TOGGLE' });

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
        <li>{`connect: ${useSelector(connected, (snapshot) => snapshot.value)}`}</li>
      </>
    );
  }

  const html = renderToString(
    <ul>
      <Toggles />
      <ToggleContext.Provider>
        <FromContext />
      </ToggleContext.Provider>
      <Konat
        defaultOpen
        fixtures={() => {
          loads.push('fixtures');

          return [];
        }}
      />
    </ul>,
  );

  connected.stop();

  expect({ html, loads, added: objectsAdded(), output }).toEqual({
    html:
      '<ul><li>useMachine: off</li><li>useActor: off</li><li>useActorRef: off</li><li>connect: on</li>' +
      '<li>createActorContext: off</li></ul>',
    loads: [],
    added: [],
    output: { warn: [], error: [] },
  });
});
