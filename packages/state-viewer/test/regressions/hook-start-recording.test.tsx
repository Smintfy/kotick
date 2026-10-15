// Hooks register the actor before @xstate/react starts it, as connect(createActor(m)).start() does, so the registry
// records every configuration the actor goes through while starting. On each real snapshot, the registry keeps
// { leaves, context } per configuration key. Here a callback child answers synchronously on start: the
// component first renders 'restoring' with { user: null } and the actor is in 'ready' right after. Both are recorded,
// so previewing 'restoring' shows the context the app really rendered it with, without a live-context warning.

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { assign, createActor, fromCallback, setup } from 'xstate';
import { connect, useActorRef, useMachine, useSelector } from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

const sessionMachine = setup({
  types: { context: {} as { user: string | null }, events: {} as { type: 'RESTORED'; user: string } },
  actors: {
    // Reads a stored session synchronously, as a callback actor reading localStorage would.
    restore: fromCallback(({ sendBack }) => {
      sendBack({ type: 'RESTORED', user: 'ada' });
    }),
  },
}).createMachine({
  id: 'session',
  context: { user: null },
  initial: 'restoring',
  states: {
    restoring: {
      invoke: { src: 'restore' },
      on: { RESTORED: { target: 'ready', actions: assign({ user: ({ event }) => event.user }) } },
    },
    ready: {},
  },
});

const rendered: string[] = [];

function Session() {
  const [snapshot] = useMachine(sessionMachine);
  rendered.push(`${String(snapshot.value)}:${snapshot.context.user}`);
  return <output data-testid="session">{`${String(snapshot.value)}:${snapshot.context.user}`}</output>;
}

function recorded(): string[] {
  const data = registry().getSnapshot().data.session;
  return data ? [...data.recorded].sort() : [];
}

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  resetRegistry();
  rendered.length = 0;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a hook actor that moves while starting', () => {
  test('control: connect() before start records the configuration it started in', async () => {
    const actor = connect(createActor(sessionMachine)).start();
    await flush();
    expect(recorded()).toEqual(['ready', 'restoring']);
    actor.stop();
  });

  test('useMachine records the configuration the component rendered before the actor moved on', async () => {
    render(<Session />);
    await flush();
    expect(rendered[0]).toBe('restoring:null');
    expect(screen.getByTestId('session').textContent).toBe('ready:ada');

    expect(recorded()).toEqual(['ready', 'restoring']);

    act(() => registry().preview(keyOf(onlyHandle('session')), { leaves: ['restoring'] }));
    expect(screen.getByTestId('session').textContent).toBe('restoring:null');
    expect(warn).not.toHaveBeenCalled();
  });

  test('useActorRef records the configuration the actor started in too', async () => {
    function SessionRef() {
      const actorRef = useActorRef(sessionMachine);
      const shown = useSelector(actorRef, (snapshot) => `${String(snapshot.value)}:${snapshot.context.user}`);
      return <output data-testid="session">{shown}</output>;
    }
    render(<SessionRef />);
    await flush();
    expect(screen.getByTestId('session').textContent).toBe('ready:ada');

    expect(recorded()).toEqual(['ready', 'restoring']);

    act(() => registry().preview(keyOf(onlyHandle('session')), { leaves: ['restoring'] }));
    expect(screen.getByTestId('session').textContent).toBe('restoring:null');
    expect(warn).not.toHaveBeenCalled();
  });
});
