// Verifies the claim that the adapter's own subscriptions to the real actor (proxy.ts connect(), connect.ts) have no
// error callback, so XState reports an error the app already handles as unhandled, which @xstate/react doesn't.

import { act, fireEvent, render, screen } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createActor, createMachine, type AnyActorRef } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { flush, resetRegistry } from '../xstate/helpers';

const BOOM = 'boom';

/** An action on BOOM throws, which puts the actor in its error state. */
const fragileMachine = createMachine({
  id: 'fragile',
  initial: 'ok',
  states: {
    ok: {
      on: {
        BOOM: {
          actions: () => {
            throw new Error(BOOM);
          },
        },
      },
    },
  },
});

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: unknown }> {
  override state: { error: unknown } = { error: undefined };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override render() {
    if (this.state.error === undefined) return this.props.children;
    return <p role="alert">{this.state.error instanceof Error ? this.state.error.message : String(this.state.error)}</p>;
  }
}

/**
 * XState's reportUnhandledError throws the error from a setTimeout callback. This collects what timer callbacks throw
 * while installed, so the report is asserted on instead of reaching Vitest as an uncaught exception.
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

type Hooks = Pick<typeof xstateReact, 'useMachine' | 'useActorRef' | 'useSelector'>;

const IMPLEMENTATIONS: [name: string, hooks: Hooks][] = [
  ['@xstate/react', xstateReact],
  ['state-viewer/xstate', stateViewer as unknown as Hooks],
];

beforeEach(() => {
  resetRegistry();
  // React logs the errors error boundaries catch.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(IMPLEMENTATIONS)('%s', (_name, hooks) => {
  test('useMachine: an action error caught by an error boundary is not also reported as unhandled', async () => {
    function Fragile() {
      const [snapshot, send] = hooks.useMachine(fragileMachine);
      return (
        <button type="button" onClick={() => send({ type: 'BOOM' })}>
          {String(snapshot.value)}
        </button>
      );
    }
    render(
      <ErrorBoundary>
        <Fragile />
      </ErrorBoundary>,
    );
    await flush();

    const reports = catchUnhandledReports();
    fireEvent.click(screen.getByRole('button'));
    const unhandled = await reports.settle();

    expect(screen.getByRole('alert').textContent).toBe(BOOM);
    expect(unhandled).toEqual([]);
  });

  test('useActorRef + useSelector: an action error caught by an error boundary is not also reported as unhandled', async () => {
    function Fragile() {
      const actorRef = hooks.useActorRef(fragileMachine);
      const value = hooks.useSelector(actorRef, (snapshot) => snapshot.value);
      return (
        <button type="button" onClick={() => actorRef.send({ type: 'BOOM' })}>
          {String(value)}
        </button>
      );
    }
    render(
      <ErrorBoundary>
        <Fragile />
      </ErrorBoundary>,
    );
    await flush();

    const reports = catchUnhandledReports();
    fireEvent.click(screen.getByRole('button'));
    const unhandled = await reports.settle();

    expect(screen.getByRole('alert').textContent).toBe(BOOM);
    expect(unhandled).toEqual([]);
  });
});

describe('connect()', () => {
  /** Creates an actor, optionally connects it, subscribes with an error callback, then makes it fail. */
  async function failHandled(useConnect: boolean): Promise<{ handled: string[]; unhandled: string[] }> {
    const real = createActor(fragileMachine);
    const actor: AnyActorRef = useConnect ? stateViewer.connect(real) : real;
    const handled: string[] = [];
    actor.subscribe({
      error: (error) => handled.push(error instanceof Error ? error.message : String(error)),
    });
    actor.start();
    await flush();

    const reports = catchUnhandledReports();
    actor.send({ type: 'BOOM' });
    const unhandled = await reports.settle();
    return { handled, unhandled };
  }

  test('plain XState: an error the app subscribes to is not reported as unhandled (control)', async () => {
    expect(await failHandled(false)).toEqual({ handled: [BOOM], unhandled: [] });
  });

  test('a connected actor: an error the app subscribes to is not reported as unhandled', async () => {
    expect(await failHandled(true)).toEqual({ handled: [BOOM], unhandled: [] });
  });
});
