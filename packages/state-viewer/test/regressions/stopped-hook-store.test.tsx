// Spec §10.2, "Previews after the actor is done": subscribers, including useSelector and the hooks' own store, keep
// receiving previews once the actor is done, and stop once it's stopped. A hook actor stays registered until its
// component unmounts (R1), so it can still be previewed after the app stops it (actorRef.stop(), the third element
// useMachine and useActor return). From then on, useMachine's and useActor's own store shows previews no more than a
// useSelector consumer of the same actor does, so every consumer of the actor shows the same thing (R10).

import { act, render, screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createMachine, type Actor, type StateValue } from 'xstate';
import { useActor, useMachine, useSelector } from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

const toggleMachine = createMachine({
  id: 'toggle',
  initial: 'off',
  states: { off: { on: { TOGGLE: 'on' } }, on: { on: { TOGGLE: 'off' } } },
});

type ToggleActor = Actor<typeof toggleMachine>;
type UseToggle = () => readonly [{ value: StateValue }, unknown, ToggleActor];

const HOOKS: [name: string, useToggle: UseToggle][] = [
  ['useMachine', () => useMachine(toggleMachine)],
  ['useActor', () => useActor(toggleMachine)],
];

// Memoized, as context consumers and list rows often are, so it only re-renders when its own subscription says so.
const Indicator = React.memo(function Indicator({ actorRef }: { actorRef: ToggleActor }) {
  const value = useSelector(actorRef, (snapshot) => snapshot.value);
  return <output data-testid="selector">{String(value)}</output>;
});

let actorRef: ToggleActor | undefined;

beforeEach(() => {
  resetRegistry();
  actorRef = undefined;
  // Previews of states without a recording or fixture warn about falling back to live context.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(HOOKS)('%s and a useSelector consumer of its actor', (_name, useToggle) => {
  function Toggle() {
    const [snapshot, , ref] = useToggle();
    actorRef = ref;
    return (
      <>
        <output data-testid="hook">{String(snapshot.value)}</output>
        <Indicator actorRef={ref} />
      </>
    );
  }

  const shown = () => ({
    hook: screen.getByTestId('hook').textContent,
    selector: screen.getByTestId('selector').textContent,
  });

  test('control: while the actor runs, both show a preview', async () => {
    render(<Toggle />);
    await flush();

    act(() => registry().preview(keyOf(onlyHandle('toggle')), { leaves: ['on'] }));

    expect(shown()).toEqual({ hook: 'on', selector: 'on' });
  });

  test('after the app stops the actor, neither shows a preview', async () => {
    render(<Toggle />);
    await flush();
    act(() => {
      actorRef?.stop();
    });
    await flush();
    // Still listed: hooks unregister on unmount, and the component is still mounted.
    const key = keyOf(onlyHandle('toggle'));

    act(() => registry().preview(key, { leaves: ['on'] }));
    await flush();
    expect(shown()).toEqual({ hook: 'off', selector: 'off' });

    act(() => registry().release(key));
    await flush();
    expect(shown()).toEqual({ hook: 'off', selector: 'off' });
  });
});
