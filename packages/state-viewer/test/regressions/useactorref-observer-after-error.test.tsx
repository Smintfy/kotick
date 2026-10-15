// An observer given to useActorRef follows the contract XState gives it: once the actor fails, nothing reaches the
// observer any more, as with @xstate/react, which subscribes it to the actor as is. With an error callback the
// observer gets the error last; without one it gets nothing for the failure, and XState reports the error as
// unhandled, once, as it does with @xstate/react. Previews of the failed actor, which hooks keep registered while the
// component is mounted, don't reach the observer either way.

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createMachine, type Actor, type Observer, type SnapshotFrom } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

const BROKEN = 'Broken on purpose';

const fragileMachine = createMachine({
  id: 'fragile',
  initial: 'ok',
  states: {
    ok: {
      on: {
        BREAK: {
          actions: () => {
            throw new Error(BROKEN);
          },
        },
      },
    },
    recovering: {},
  },
});

type FragileSnapshot = SnapshotFrom<typeof fragileMachine>;
type Hooks = Pick<typeof xstateReact, 'useActorRef'>;

const IMPLEMENTATIONS: [name: string, hooks: Hooks][] = [
  ['@xstate/react (control)', xstateReact],
  ['state-viewer/xstate', stateViewer as unknown as Hooks],
];

/**
 * XState reports an error no observer handles by throwing it from a setTimeout callback. This collects what timer
 * callbacks throw while installed, so the report is asserted on instead of reaching Vitest as an uncaught exception.
 */
function catchUnhandledReports() {
  const original = globalThis.setTimeout;
  const errors: unknown[] = [];
  const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
    handler: (...args: unknown[]) => void,
    timeout?: number,
    ...args: unknown[]
  ) =>
    original(() => {
      try {
        handler(...args);
      } catch (error) {
        errors.push(error);
      }
    }, timeout)) as unknown as typeof setTimeout);
  return {
    /** Messages of the errors reported as unhandled, once pending timers have run. */
    async settle(): Promise<string[]> {
      await act(() => new Promise<void>((resolve) => original(resolve, 20)));
      spy.mockRestore();
      return errors.map((error) => (error instanceof Error ? error.message : String(error)));
    },
  };
}

/**
 * Mounts useActorRef with an observer, with or without an error callback, and breaks the actor. Returns everything
 * the observer was told, what it was told from the failure on, and what XState reported as unhandled.
 */
async function breakObservedActor(hooks: Hooks, { withError }: { withError: boolean }) {
  const calls: string[] = [];
  const observer: Observer<FragileSnapshot> = {
    next: (snapshot) => calls.push(`next:${String(snapshot.value)}`),
    complete: () => calls.push('complete'),
  };
  if (withError) observer.error = (error) => calls.push(`error:${(error as Error).message}`);
  let actorRef: Actor<typeof fragileMachine> | undefined;
  function Fragile() {
    actorRef = hooks.useActorRef(fragileMachine, undefined, observer);
    return null;
  }
  render(<Fragile />);
  await flush();

  // StrictMode's double mount starts the actor twice, so the observer may get the initial snapshot more than once.
  expect(new Set(calls)).toEqual(new Set(['next:ok']));
  const beforeFailure = calls.length;

  const reports = catchUnhandledReports();
  act(() => actorRef?.send({ type: 'BREAK' }));
  const unhandled = await reports.settle();
  await flush();
  return { calls, fromFailure: calls.slice(beforeFailure), unhandled };
}

/** Previews the failed actor in two states and releases it, as someone in the overlay would. */
async function previewFailedActor(): Promise<void> {
  const key = keyOf(onlyHandle('fragile'));
  act(() => registry().preview(key, { leaves: ['recovering'] }));
  await flush();
  act(() => registry().preview(key, { leaves: ['ok'] }));
  await flush();
  act(() => registry().release());
  await flush();
}

beforeEach(() => {
  resetRegistry();
  // Previews of states without a recording or fixture warn about falling back to live context.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(IMPLEMENTATIONS)('%s: an observer given to useActorRef, when the actor fails', (_name, hooks) => {
  test('with an error callback, gets the error last, and the error is not reported as unhandled', async () => {
    const { fromFailure, unhandled } = await breakObservedActor(hooks, { withError: true });
    expect(fromFailure).toEqual([`error:${BROKEN}`]);
    expect(unhandled).toEqual([]);
  });

  test('without an error callback, gets nothing for the failure, and XState reports the error as unhandled', async () => {
    const { fromFailure, unhandled } = await breakObservedActor(hooks, { withError: false });
    expect(fromFailure).toEqual([]);
    expect(unhandled).toEqual([BROKEN]);
  });
});

describe('state-viewer/xstate: an observer given to useActorRef, after the actor failed', () => {
  const hooks = stateViewer as unknown as Hooks;

  test('with an error callback, gets nothing when the failed actor is previewed', async () => {
    const { calls } = await breakObservedActor(hooks, { withError: true });
    const before = [...calls];

    await previewFailedActor();

    expect(calls).toEqual(before);
  });

  test('without an error callback, gets nothing when the failed actor is previewed', async () => {
    const { calls } = await breakObservedActor(hooks, { withError: false });
    const before = [...calls];

    await previewFailedActor();

    expect(calls).toEqual(before);
  });
});
