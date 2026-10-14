// Instance keys of hooks must be unique on the page. useId() is only unique within one React root: two islands
// hydrated with hydrateRoot and no identifierPrefix get the same tree-position id, so both actors land on one key.

import { act, render, type RenderResult } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { createMachine } from 'xstate';
import { useMachine } from '../../src/xstate';
import { flush, handlesOf, keyOf, registry, resetRegistry } from '../xstate/helpers';

const toggleMachine = createMachine({
  id: 'toggle',
  initial: 'off',
  states: { off: { on: { TOGGLE: 'on' } }, on: { on: { TOGGLE: 'off' } } },
});

function Toggle() {
  const [snapshot] = useMachine(toggleMachine);
  return <output>{String(snapshot.value)}</output>;
}

/** An island the way island architectures ship one: server markup in its own container, hydrated as its own root. */
function hydrateIsland(): RenderResult {
  const container = document.createElement('div');
  container.innerHTML = '<output>off</output>';
  document.body.append(container);
  return render(<Toggle />, { container, hydrate: true, onRecoverableError: (error) => recoverable.push(error) });
}

let warn: MockInstance;
/** Hydration mismatches React recovered from by rendering the island again on the client. */
let recoverable: unknown[];

beforeEach(() => {
  resetRegistry();
  recoverable = [];
  // Previews without recorded or fixture context fall back to live context with a warning.
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('instance keys across hydrated roots', () => {
  test('two islands of the same machine register as two instances', async () => {
    hydrateIsland();
    hydrateIsland();
    await flush();

    const handles = handlesOf('toggle');
    expect(handles).toHaveLength(2);
    expect(new Set(handles.map(keyOf)).size).toBe(2);
  });

  test('previewing one island leaves the other showing its real state', async () => {
    const a = hydrateIsland();
    const b = hydrateIsland();
    await flush();

    const [first] = handlesOf('toggle');
    act(() => registry().preview(keyOf(first), { leaves: ['on'] }));

    const shown = [a.container.textContent, b.container.textContent].sort();
    expect(shown).toEqual(['off', 'on']);
  });

  test('unmounting one island keeps the other listed', async () => {
    hydrateIsland();
    const b = hydrateIsland();
    await flush();

    b.unmount();
    await flush();
    expect(handlesOf('toggle')).toHaveLength(1);
  });

  test("an island hydrating during another island's preview hydrates its own real state", async () => {
    hydrateIsland();
    await flush();
    const [first] = handlesOf('toggle');
    act(() => registry().preview(keyOf(first), { leaves: ['on'] }));

    const late = hydrateIsland();
    await flush();
    expect(recoverable).toEqual([]);
    expect(late.container.textContent).toBe('off');
  });
});
