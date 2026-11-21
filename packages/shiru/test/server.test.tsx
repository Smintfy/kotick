// @vitest-environment node

import { renderToString } from 'react-dom/server';
import { Shiru } from 'shiru';
import { defineReducerMachine, useMachineReducer } from 'shiru/reducer';
import { connect, createActorContext, useActor, useActorRef, useMachine, useSelector } from 'shiru/xstate';
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

const globalsAtLoad = Reflect.ownKeys(globalThis);

/**
 * The hooks of both adapters and connect() count instances in a number on globalThis, also on the server.
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
      <Shiru
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

test('a reducer machine renders its initial state, runs no effect, and no registry goes on globalThis', () => {
  const output = watchConsole();
  const effects: string[] = [];

  const machine = defineReducerMachine<{ status: 'off' } | { status: 'on' }, ToggleEvent>()({
    id: 'toggle',
    discriminant: 'status',
    states: {
      off: { on: { TOGGLE: () => ({ status: 'on' }) } },
      on: {
        on: { TOGGLE: () => ({ status: 'off' }) },
        effect: () => {
          effects.push('start');
        },
      },
    },
  });

  function Toggle() {
    const [state] = useMachineReducer(machine, () => ({ status: 'on' }), { debug: { label: 'Server' } });

    return <p>{state.status}</p>;
  }

  const html = renderToString(
    <>
      <Toggle />
      <Shiru defaultOpen />
    </>,
  );

  expect({ html, effects, added: objectsAdded(), output }).toEqual({
    html: '<p>on</p>',
    effects: [],
    added: [],
    output: { warn: [], error: [] },
  });
});
