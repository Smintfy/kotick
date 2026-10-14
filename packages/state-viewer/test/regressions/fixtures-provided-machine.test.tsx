// A component that injects implementations with machine.provide() and names the instance with debug.id: the actor's
// logic is the clone provide() returns, not the machine the fixtures were defined for, and its registry id differs from
// machine.id. R18 says fixtures match "the same machine object first, then the same machine id, so debug.id ... need[s]
// no extra setup"; @xstate/react itself treats a provide() clone as the same machine (it keys its actor on
// logic.config, which provide() shares).

import { act, render, screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { setup } from 'xstate';
import { defineFixtures, useMachine } from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

const toggleMachine = setup({
  types: {
    context: {} as { count: number; owner: string },
    events: {} as { type: 'TOGGLE' },
  },
  actions: { announce: () => {} },
}).createMachine({
  id: 'toggle',
  context: { count: 0, owner: 'live' },
  initial: 'inactive',
  states: {
    inactive: { on: { TOGGLE: 'active' } },
    active: { entry: 'announce', on: { TOGGLE: 'inactive' } },
  },
});

function Toggle({ debugId, provided }: { debugId?: string; provided: boolean }) {
  // The everyday XState v5 pattern: implementations that need React (callbacks, navigation) are provided inline.
  const logic = provided ? toggleMachine.provide({ actions: { announce: () => {} } }) : toggleMachine;
  const [snapshot] = useMachine(logic, debugId === undefined ? undefined : { debug: { id: debugId } });
  return <output data-testid="toggle">{`${String(snapshot.value)}:${snapshot.context.owner}`}</output>;
}

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  resetRegistry();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  act(() =>
    registry().registerFixtures([defineFixtures(toggleMachine, { active: { context: { count: 7, owner: 'fixture' } } })]),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function mount(props: { debugId?: string; provided: boolean }): Promise<string> {
  render(<Toggle {...props} />);
  await flush();
  return keyOf(onlyHandle(props.debugId ?? 'toggle'));
}

function previewActive(key: string): void {
  act(() => registry().preview(key, { leaves: ['active'] }));
}

const liveFallbackWarnings = () =>
  warn.mock.calls.map(([message]) => String(message)).filter((message) => message.includes('No recorded or fixture'));

describe('fixtures for a machine used through machine.provide()', () => {
  test('control: the original machine under debug.id matches by machine object', async () => {
    const key = await mount({ debugId: 'prov-x', provided: false });
    expect(registry().getSnapshot().data['prov-x']?.fixture.has('active')).toBe(true);

    previewActive(key);
    expect(registry().getOverride(key)).toMatchObject({ source: 'fixture', context: { owner: 'fixture' } });
  });

  test('control: a provided clone without debug.id matches by machine id', async () => {
    const key = await mount({ provided: true });
    expect(registry().getSnapshot().data['toggle']?.fixture.has('active')).toBe(true);

    previewActive(key);
    expect(registry().getOverride(key)).toMatchObject({ source: 'fixture', context: { owner: 'fixture' } });
  });

  test('a provided clone under debug.id still gets the fixtures of the machine it came from', async () => {
    const key = await mount({ debugId: 'prov-x', provided: true });
    expect(onlyHandle('prov-x').source).not.toBe(toggleMachine);

    expect.soft(registry().getSnapshot().data['prov-x']?.fixture.has('active')).toBe(true);

    previewActive(key);
    expect(registry().getOverride(key)).toMatchObject({ source: 'fixture', context: { owner: 'fixture' } });
    expect(screen.getByTestId('toggle').textContent).toBe('active:fixture');
    expect(liveFallbackWarnings()).toEqual([]);
  });
});
