'use client';

// Uses every hook and helper of konat/xstate, as an app does.
// The production build must keep only what @xstate/react gives.

import { connect, createActorContext, useActor, useActorRef, useMachine, useSelector } from 'konat/xstate';
import { createActor } from 'xstate';
import { toggleMachine } from './toggle';

const appActor = connect(createActor(toggleMachine).start(), { id: 'app' });
const ToggleContext = createActorContext(toggleMachine);

function WithMachine() {
  const [snapshot, send] = useMachine(toggleMachine, { debug: { id: 'toggle', label: 'Toggle' } });

  return (
    <button type="button" onClick={() => send({ type: 'TOGGLE' })}>
      useMachine: {String(snapshot.value)}
    </button>
  );
}

function WithActor() {
  const [snapshot] = useActor(toggleMachine);

  return <p>useActor: {String(snapshot.value)}</p>;
}

function WithActorRef() {
  const actorRef = useActorRef(toggleMachine);
  const count = useSelector(actorRef, (snapshot) => snapshot.context.count);

  return <p>useActorRef: {count}</p>;
}

function WithContext() {
  const value = ToggleContext.useSelector((snapshot) => snapshot.value);

  return <p>createActorContext: {String(value)}</p>;
}

function WithConnect() {
  const value = useSelector(appActor, (snapshot) => snapshot.value);

  return <p>connect: {String(value)}</p>;
}

export function Demo() {
  return (
    <main>
      <WithMachine />
      <WithActor />
      <WithActorRef />
      <ToggleContext.Provider>
        <WithContext />
      </ToggleContext.Provider>
      <WithConnect />
    </main>
  );
}
