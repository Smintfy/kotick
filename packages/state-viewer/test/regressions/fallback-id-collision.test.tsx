// Two different machines without an id but with the same states: the generated fallback id is only a hash of the
// state tree's keys and types, so both register under one id and share recordings and fixtures.

import { act, render, screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { assign, setup, type AnyActorRef } from 'xstate';
import { defineFixtures, useMachine } from '../../src/xstate';
import { resolveMachineId } from '../../src/xstate/machine-id';
import { flush, keyOf, registry, resetRegistry } from '../xstate/helpers';

// Two everyday fetch machines, neither given an id: same states, different context.
const usersMachine = setup({
  types: {
    context: {} as { users: string[] },
    events: {} as { type: 'FETCH' } | { type: 'LOADED'; users: string[] },
  },
}).createMachine({
  context: { users: [] },
  initial: 'idle',
  states: {
    idle: { on: { FETCH: 'loading' } },
    loading: { on: { LOADED: { target: 'success', actions: assign({ users: ({ event }) => event.users }) } } },
    success: {},
    failure: {},
  },
});

const postsMachine = setup({
  types: {
    context: {} as { posts: { title: string }[] },
    events: {} as { type: 'FETCH' } | { type: 'LOADED'; posts: { title: string }[] },
  },
}).createMachine({
  context: { posts: [] },
  initial: 'idle',
  states: {
    idle: { on: { FETCH: 'loading' } },
    loading: { on: { LOADED: { target: 'success', actions: assign({ posts: ({ event }) => event.posts }) } } },
    success: {},
    failure: {},
  },
});

let usersActor: AnyActorRef | undefined;

function Users() {
  const [snapshot, , actor] = useMachine(usersMachine);
  usersActor = actor;
  return <output data-testid="users">{snapshot.context.users.join(',')}</output>;
}

function Posts() {
  const [snapshot] = useMachine(postsMachine);
  return <output data-testid="posts">{snapshot.context.posts.map((post) => post.title).join(',')}</output>;
}

beforeEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  resetRegistry();
  usersActor = undefined;
  // The fallback-id warning and the live-fallback warning aren't what this file checks.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fallback ids of different anonymous machines with the same states', () => {
  test('the two machines get different fallback ids', () => {
    expect(usersMachine.id).toBe('(machine)');
    expect(postsMachine.id).toBe('(machine)');

    expect(resolveMachineId(postsMachine)).not.toBe(resolveMachineId(usersMachine));
  });

  test('they register as two machines, not as two instances of one', async () => {
    render(
      <>
        <Users />
        <Posts />
      </>,
    );
    await flush();

    const handles = registry().getSnapshot().machines;
    expect(handles).toHaveLength(2);
    expect(handles[0].source).toBe(usersMachine.config);
    expect(handles[1].source).toBe(postsMachine.config);
    expect(handles[1].machineId).not.toBe(handles[0].machineId);
  });

  test("previewing a state on one machine doesn't use context recorded by the other", async () => {
    render(
      <>
        <Users />
        <Posts />
      </>,
    );
    await flush();
    act(() => {
      usersActor?.send({ type: 'FETCH' });
      usersActor?.send({ type: 'LOADED', users: ['a'] });
    });
    await flush();
    expect(screen.getByTestId('users').textContent).toBe('a');

    const postsHandle = registry()
      .getSnapshot()
      .machines.find((handle) => handle.source === postsMachine.config);
    if (!postsHandle) throw new Error('The posts machine did not register.');
    const postsKey = keyOf(postsHandle);

    // The posts machine has never been in `success`, so there is nothing recorded for it: the preview falls back to live
    // context, never to the users machine's `{ users: ['a'] }` (which would make `context.posts.map` throw).
    let renderError: unknown;
    try {
      act(() => registry().preview(postsKey, { leaves: ['success'] }));
    } catch (error) {
      renderError = error;
    }
    expect(registry().getOverride(postsKey)).toMatchObject({ source: 'live', context: { posts: [] } });
    expect(renderError).toBeUndefined();
  });

  test("fixtures for one machine don't apply to the other", async () => {
    const usersFixtures = defineFixtures(usersMachine, { success: { context: { users: ['fixture'] } } });
    act(() => registry().registerFixtures([usersFixtures]));
    render(<Posts />);
    await flush();

    const [postsHandle] = registry().getSnapshot().machines;
    expect(postsHandle.source).toBe(postsMachine.config);
    expect(registry().getSnapshot().data[postsHandle.machineId]?.fixture.has('success') ?? false).toBe(false);
  });
});
