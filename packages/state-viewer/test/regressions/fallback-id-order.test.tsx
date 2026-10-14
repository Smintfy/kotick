// The generated fallback id of an anonymous machine (R4) changes only when states are added, removed, renamed or
// change type, or context keys come and go (spec §10.2), not when states are reordered, at the top level or inside a
// compound state. HMR recreates the machine, and previews and id-matched fixtures follow the registry id, so an HMR
// edit that only moves a state up or down keeps the preview showing and the fixtures applying, as an edit that
// changes a transition or a context value does (the control).

import { act, render, screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createMachine, type AnyStateMachine } from 'xstate';
import { defineFixtures, useMachine } from '../../src/xstate';
import { resolveMachineId } from '../../src/xstate/machine-id';
import { flush, keyOf, registry, resetRegistry } from '../xstate/helpers';

type Edit = 'original' | 'transition and context' | 'top-level order' | 'nested order';

/** The same anonymous fetch machine, after an HMR edit of one kind. */
function createFetch(edit: Edit = 'original') {
  const success = { on: { RESET: 'idle' } };
  const retryable = {};
  const offline = {};
  const failure = {
    initial: 'retryable',
    on: { RETRY: 'loading' },
    states: edit === 'nested order' ? { offline, retryable } : { retryable, offline },
  };
  return createMachine({
    context: { items: [] as string[], error: edit === 'transition and context' ? 'x' : '' },
    initial: 'idle',
    states: {
      idle: { on: { FETCH: 'loading' } },
      loading: edit === 'transition and context' ? { on: { DONE: 'success' } } : {},
      ...(edit === 'top-level order' ? { failure, success } : { success, failure }),
    },
  });
}

function stateOrder(machine: AnyStateMachine): string[] {
  return [...Object.keys(machine.root.states), ...Object.keys(machine.root.states.failure.states)];
}

function Fetch({ logic }: { logic: AnyStateMachine }) {
  const [snapshot] = useMachine(logic);
  return <output data-testid="fetch">{JSON.stringify(snapshot.value)}</output>;
}

const EDITS: [description: string, edit: Edit][] = [
  ['changing a transition and a context value (control)', 'transition and context'],
  ['moving a top-level state', 'top-level order'],
  ['moving a nested state', 'nested order'],
];

beforeEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  resetRegistry();
  // The fallback-id warning and live-context fallbacks aren't what this file checks.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('the reordered machines have the same states as the original, in another order', () => {
  const original = createFetch();
  expect(original.id).toBe('(machine)');
  for (const edit of ['top-level order', 'nested order'] as const) {
    const reordered = createFetch(edit);
    expect(stateOrder(reordered)).not.toEqual(stateOrder(original));
    expect([...stateOrder(reordered)].sort()).toEqual([...stateOrder(original)].sort());
  }
});

describe.each(EDITS)('an HMR edit %s', (_description, edit) => {
  test('keeps the generated id', () => {
    expect(resolveMachineId(createFetch(edit))).toBe(resolveMachineId(createFetch()));
  });

  test('keeps the preview showing', async () => {
    const view = render(<Fetch logic={createFetch()} />);
    await flush();
    const [handle] = registry().getSnapshot().machines;
    const key = keyOf(handle);
    act(() => registry().preview(key, { leaves: ['failure.offline'] }));
    await flush();
    expect(screen.getByTestId('fetch').textContent).toBe('{"failure":"offline"}');

    // HMR: the module re-runs and the component gets the recreated machine.
    view.rerender(<Fetch logic={createFetch(edit)} />);
    await flush();

    const [after] = registry().getSnapshot().machines;
    expect(keyOf(after)).toBe(key);
    expect(registry().getOverride(key)).toBeDefined();
    expect(screen.getByTestId('fetch').textContent).toBe('{"failure":"offline"}');
  });

  test('keeps the fixtures registered for the machine applying', async () => {
    act(() =>
      registry().registerFixtures([
        defineFixtures(createFetch(), { 'failure.offline': { context: { items: [], error: 'Network down' } } }),
      ]),
    );
    const view = render(<Fetch logic={createFetch()} />);
    await flush();
    view.rerender(<Fetch logic={createFetch(edit)} />);
    await flush();

    const [handle] = registry().getSnapshot().machines;
    expect(registry().getSnapshot().data[handle.machineId]?.fixture.has('failure.offline') ?? false).toBe(true);
  });
});
