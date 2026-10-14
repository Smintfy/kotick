'use client';

// src/demo.tsx written against @xstate/react, without the debugger: what a production build of the demo must match.

import { createActorContext, useActor, useActorRef, useMachine, useSelector } from '@xstate/react';
import { createActor } from 'xstate';
import { toggleMachine } from './toggle';

const appActor = createActor(toggleMachine).start();
const ToggleContext = createActorContext(toggleMachine);

function WithMachine() {
  const [snapshot, send] = useMachine(toggleMachine);
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
