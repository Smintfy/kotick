// Fast Refresh in the React hooks of state-viewer/xstate, under StrictMode (see test/setup.ts).

import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { assign, createMachine, setup } from 'xstate';
import type { MachineHandle } from '../../src/core/types';
import { useMachine } from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from './helpers';

// ---------------------------------------------------------------------------------------------------------------------
// Machines

type ToggleEvent = { type: 'TOGGLE' };

/** A fresh machine object from a fresh config object each call, the way Fast Refresh re-evaluates a module. */
function createToggleMachine() {
  return setup({
    types: { context: {} as { flips: number }, events: {} as ToggleEvent },
  }).createMachine({
    id: 'toggle',
    initial: 'off',
    context: { flips: 0 },
    states: {
      off: { on: { TOGGLE: { target: 'on', actions: assign({ flips: ({ context }) => context.flips + 1 }) } } },
      on: {
        tags: ['lit'],
        on: { TOGGLE: { target: 'off', actions: assign({ flips: ({ context }) => context.flips + 1 }) } },
      },
    },
  });
}

const toggleMachine = createToggleMachine();

// ---------------------------------------------------------------------------------------------------------------------
// Mount and render counters, kept outside React so a remount, which throws away component state, still counts. As in
// examples/vite-react/src/renderStats.ts, StrictMode's simulated unmount and its double render aren't counted.

type Stats = { mounts: number; renders: number };
const stats = new Map<string, Stats>();

function statsOf(name: string): Stats {
  let entry = stats.get(name);
  if (!entry) {
    entry = { mounts: 0, renders: 0 };
    stats.set(name, entry);
  }
  return entry;
}

function useRenderStats(name: string): void {
  // Refs survive StrictMode's simulated unmount, but not a real remount.
  const mounted = React.useRef(false);
  const lastRender = React.useRef<object | null>(null);
  const thisRender = {};
  React.useLayoutEffect(() => {
    const entry = statsOf(name);
    if (!mounted.current) {
      mounted.current = true;
      entry.mounts += 1;
    }
    // StrictMode re-runs this effect with the same closure, so the render object repeats.
    if (lastRender.current !== thisRender) {
      lastRender.current = thisRender;
      entry.renders += 1;
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Helpers

function text(testId: string): string | null {
  return screen.getByTestId(testId).textContent;
}

function previewOn(handle: MachineHandle, leaves: string[]): void {
  act(() => registry().preview(keyOf(handle), { leaves }));
}

function releaseAll(): void {
  act(() => registry().release());
}

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  resetRegistry();
  stats.clear();
  // Previews of states with no recording or fixture fall back to live context, with a warning.
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  // React logs the errors error boundaries catch.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------------------------------

describe('Fast Refresh', () => {
  /** Every value Toggle rendered, StrictMode's double renders included. */
  let shown: string[] = [];

  beforeEach(() => {
    shown = [];
  });

  function Toggle({ machine }: { machine: typeof toggleMachine }) {
    const [snapshot, send] = useMachine(machine);
    shown.push(snapshot.value);
    useRenderStats('toggle');
    return (
      <button type="button" onClick={() => send({ type: 'TOGGLE' })}>
        {snapshot.value}
      </button>
    );
  }

  test('a new machine object keeps the instance key and the preview, and registers the new actor', async () => {
    const before = createToggleMachine();
    const after = createToggleMachine();
    const { rerender } = render(<Toggle machine={before} />);
    await flush();
    const oldHandle = onlyHandle('toggle');

    previewOn(oldHandle, ['on']);
    expect(screen.getByRole('button').textContent).toBe('on');

    shown = [];
    rerender(<Toggle machine={after} />);
    await flush();
    // The preview never dropped out while the actor was swapped.
    expect(shown.length).toBeGreaterThan(0);
    expect(new Set(shown)).toEqual(new Set(['on']));

    const newHandle = onlyHandle('toggle');
    expect(newHandle).not.toBe(oldHandle);
    expect(keyOf(newHandle)).toBe(keyOf(oldHandle));
    expect(newHandle.source).toBe(after.config);
    expect(registry().getOverride(keyOf(newHandle))?.requested).toEqual(['on']);
    expect(screen.getByRole('button').textContent).toBe('on');

    releaseAll();
    expect(screen.getByRole('button').textContent).toBe('off');

    // The new actor is the one consumers drive and the registry watches.
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').textContent).toBe('on');
    expect(newHandle.getActiveLeaves()).toEqual(['on']);
    expect(statsOf('toggle').mounts).toBe(1);
  });

  test('a preview naming a state the new machine no longer has is released', async () => {
    const withExtra = createMachine({
      id: 'toggle',
      initial: 'off',
      context: { flips: 0 },
      states: { off: { on: { TOGGLE: 'on' } }, on: { on: { TOGGLE: 'off' } }, flickering: {} },
    }) as unknown as typeof toggleMachine;
    const withoutExtra = createToggleMachine();
    const { rerender } = render(<Toggle machine={withExtra} />);
    await flush();

    previewOn(onlyHandle('toggle'), ['flickering']);
    expect(screen.getByRole('button').textContent).toBe('flickering');

    rerender(<Toggle machine={withoutExtra} />);
    await flush();
    expect(registry().getSnapshot().overrides).toEqual({});
    expect(onlyHandle('toggle').source).toBe(withoutExtra.config);
    expect(screen.getByRole('button').textContent).toBe('off');
    expect(statsOf('toggle').mounts).toBe(1);
  });

  test('a machine without an id keeps its generated id and warns once', async () => {
    function createAnonymous() {
      return createMachine({ initial: 'idle', states: { idle: { on: { GO: 'busy' } }, busy: {} } });
    }
    function Anonymous({ machine }: { machine: ReturnType<typeof createAnonymous> }) {
      const [snapshot] = useMachine(machine);
      return <output data-testid="value">{String(snapshot.value)}</output>;
    }
    const { rerender } = render(<Anonymous machine={createAnonymous()} />);
    await flush();
    const [first] = registry().getSnapshot().machines;
    expect(first.machineId).toMatch(/^machine-/);

    previewOn(first, ['busy']);
    rerender(<Anonymous machine={createAnonymous()} />);
    await flush();

    const [second] = registry().getSnapshot().machines;
    expect(keyOf(second)).toBe(keyOf(first));
    expect(second).not.toBe(first);
    expect(text('value')).toBe('busy');
    const idWarnings = warn.mock.calls.filter(([message]) => String(message).includes('has no id'));
    expect(idWarnings).toHaveLength(1);
  });
});
