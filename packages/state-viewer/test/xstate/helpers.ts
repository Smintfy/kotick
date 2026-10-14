// Shared setup for adapter tests: the adapter reads the page's registry through getRegistry(), so each test gets a
// fresh one and clean storage.

import { act } from '@testing-library/react';
import * as React from 'react';
import { describe } from 'vitest';
import { createActor, createMachine } from 'xstate';
import { getRegistry, REGISTRY_KEY, toInstanceKey } from '../../src/core/registry';
import type { MachineHandle, Registry } from '../../src/core/types';

/**
 * True when XState's own actors have select(), which XState 5.29 added.
 * The adapter's proxy has select() with every supported XState, so only the @xstate/react controls need this.
 */
export const ACTOR_SELECT = typeof (createActor(createMachine({})) as { select?: unknown }).select === 'function';

/** True when React has <Activity>, which React 19.2 added. The tests built on it skip with React 18. */
export const HAS_ACTIVITY = 'Activity' in React;

/** A describe that runs only when React has <Activity>. */
export const describeWithActivity = describe.runIf(HAS_ACTIVITY);

/** The major version of the installed React. The test matrix (scripts/test-matrix.mjs) runs React 18 and 19. */
export const REACT_MAJOR = Number(React.version.split('.')[0]);

/** Drops the page's registry and recordings, so the next getRegistry() creates a new one. */
export function resetRegistry(): void {
  delete (globalThis as Record<string, unknown>)[REGISTRY_KEY];
  sessionStorage.clear();
}

export function registry(): Registry {
  return getRegistry();
}

/** Runs the registry's batched flush (a microtask) inside act(), so React sees the result. */
export async function flush(): Promise<void> {
  await act(async () => {});
}

export function keyOf(handle: MachineHandle): string {
  return toInstanceKey(handle.machineId, handle.instanceId);
}

/** Registered handles of a machine id, in registration order. */
export function handlesOf(machineId: string): MachineHandle[] {
  return getRegistry()
    .getSnapshot()
    .machines.filter((handle) => handle.machineId === machineId);
}

/** The only registered handle of a machine id; throws when there are none or several. */
export function onlyHandle(machineId: string): MachineHandle {
  const handles = handlesOf(machineId);
  if (handles.length !== 1) throw new Error(`Expected one "${machineId}" handle, found ${handles.length}.`);
  return handles[0];
}
