// useSelector, on its own or through createActorContext, follows previews of an actor that failed while a preview hid
// the failure, and once the preview is released it re-renders and throws the real error to the nearest error boundary,
// as @xstate/react's useSelector does without a preview. A
// consumer that mounts while the failed actor is previewed follows previews too: XState tells its observer about the
// failure as it subscribes, and the proxy holds that back while the preview hides the real snapshot. Whether XState
// reports the error as unhandled depends only on what was subscribed when the actor failed, as with @xstate/react:
// nothing is reported while a useSelector consumer or the hooks' store listens, and the error is reported once when
// nothing that handles errors was. An app observer with next and error gets nothing after its error, previews included.

import { act, render, screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SimulatedClock, createActor, fromCallback, setup, type Actor } from 'xstate';
import { connect, createActorContext, useActorRef, useMachine, useSelector } from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

const CRASH = 'Upload crashed';

const crash = (): never => {
  throw new Error(CRASH);
};

/** What the invoked socket uses to send its parent BREAK, as a server push would, past the proxy. */
let pushBreak: (() => void) | undefined;

/**
 * Fails when its socket pushes BREAK, or on its own after a second (a delayed transition whose action throws); either
 * way the event reaches the real actor during a preview. `retrying` and `done` exist to be previewed.
 */
const uploadMachine = setup({
  actors: {
    socket: fromCallback(({ sendBack }) => {
      pushBreak = () => sendBack({ type: 'BREAK' });
      return () => {
        pushBreak = undefined;
      };
    }),
  },
}).createMachine({
  id: 'upload',
  initial: 'uploading',
  invoke: { src: 'socket' },
  states: {
    uploading: {
      after: { 1000: { actions: crash } },
      on: { BREAK: { actions: crash } },
    },
    retrying: {},
    done: {},
  },
});

type UploadActor = Actor<typeof uploadMachine>;

/** The ways the real actor fails underneath a preview, without the app sending it anything. */
const FAILURES: [name: string, fail: (clock: SimulatedClock) => void][] = [
  ['an event from its invoked socket', () => pushBreak?.()],
  ['its own delayed transition', (clock) => clock.increment(1000)],
];

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

type AppProps = { clock: SimulatedClock; showStatus: boolean };

function Status({ value }: { value: string }) {
  return <output data-testid="status">{value}</output>;
}

const UploadContext = createActorContext(uploadMachine);

function ContextStatus() {
  return <Status value={UploadContext.useSelector((snapshot) => String(snapshot.value))} />;
}

/** The Provider creates the actor; the consumer may mount later. */
function ContextApp({ clock, showStatus }: AppProps) {
  return <UploadContext.Provider options={{ clock }}>{showStatus ? <ContextStatus /> : null}</UploadContext.Provider>;
}

function RefStatus({ actorRef }: { actorRef: UploadActor }) {
  return <Status value={useSelector(actorRef, (snapshot) => String(snapshot.value))} />;
}

/** useActorRef creates the actor; the consumer, given its proxy, may mount later. */
function RefApp({ clock, showStatus }: AppProps) {
  const actorRef = useActorRef(uploadMachine, { clock });
  return showStatus ? <RefStatus actorRef={actorRef} /> : null;
}

function MachineApp({ clock }: AppProps) {
  const [snapshot] = useMachine(uploadMachine, { clock });
  return <Status value={String(snapshot.value)} />;
}

const SELECTOR_APPS: [name: string, App: (props: AppProps) => React.ReactElement | null][] = [
  ['useSelector on the proxy useActorRef returns', RefApp],
  ["createActorContext's useSelector", ContextApp],
];

/** What the app shows: the status, or the error its boundary caught. */
const shown = (): string | null =>
  screen.queryByTestId('status')?.textContent ?? screen.queryByRole('alert')?.textContent ?? null;

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
 * Renders `app` inside an error boundary, previews `retrying` on the upload, as someone in the overlay would, and lets
 * the real actor fail underneath. Returns the instance key, what XState reported as unhandled, and a rerender that
 * keeps the boundary.
 */
async function failDuringPreview(
  app: React.ReactElement,
  fail: () => void,
): Promise<{ key: string; unhandled: string[]; rerender: (app: React.ReactElement) => void }> {
  const view = render(<ErrorBoundary>{app}</ErrorBoundary>);
  await flush();
  const key = keyOf(onlyHandle('upload'));

  act(() => registry().preview(key, { leaves: ['retrying'] }));
  await flush();

  const reports = catchUnhandledReports();
  act(fail);
  const unhandled = await reports.settle();
  await flush();
  return { key, unhandled, rerender: (next) => view.rerender(<ErrorBoundary>{next}</ErrorBoundary>) };
}

let clock: SimulatedClock;

beforeEach(() => {
  resetRegistry();
  pushBreak = undefined;
  clock = new SimulatedClock();
  // Previews of states without a recording or fixture warn about falling back to live context.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // React logs the errors error boundaries catch.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(FAILURES)('an actor that fails during a preview, from %s', (_failure, fail) => {
  test('control: useMachine follows later previews, and release throws the failure to the boundary', async () => {
    const { key, unhandled } = await failDuringPreview(<MachineApp clock={clock} showStatus />, () => fail(clock));
    expect(unhandled).toEqual([]);
    // The preview hides the failure.
    expect(shown()).toBe('retrying');

    act(() => registry().preview(key, { leaves: ['done'] }));
    await flush();
    expect(shown()).toBe('done');

    act(() => registry().release());
    await flush();
    expect(shown()).toBe(CRASH);
  });

  describe.each(SELECTOR_APPS)('%s', (_name, App) => {
    test('follows later previews of the failed actor', async () => {
      const { key, unhandled } = await failDuringPreview(<App clock={clock} showStatus />, () => fail(clock));
      expect(unhandled).toEqual([]);
      expect(shown()).toBe('retrying');

      act(() => registry().preview(key, { leaves: ['done'] }));
      await flush();
      expect(shown()).toBe('done');

      act(() => registry().preview(key, { leaves: ['uploading'] }));
      await flush();
      expect(shown()).toBe('uploading');
    });

    test('once the preview is released, re-renders and throws the real error to the boundary', async () => {
      const { unhandled } = await failDuringPreview(<App clock={clock} showStatus />, () => fail(clock));
      expect(unhandled).toEqual([]);
      expect(shown()).toBe('retrying');

      act(() => registry().release());
      await flush();

      expect(registry().getSnapshot().overrides).toEqual({});
      expect(screen.queryByTestId('status')).toBeNull();
      expect(shown()).toBe(CRASH);
    });

    test('a consumer that mounts while the failed actor is previewed follows previews, then throws on release', async () => {
      const { key, unhandled, rerender } = await failDuringPreview(<App clock={clock} showStatus={false} />, () =>
        fail(clock),
      );
      // Nothing that handles errors was subscribed when the actor failed, so XState reported it, as without a preview.
      expect(unhandled).toEqual([CRASH]);

      // A tab opens, say, while the developer keeps the preview up.
      rerender(<App clock={clock} showStatus />);
      await flush();
      expect(shown()).toBe('retrying');

      act(() => registry().preview(key, { leaves: ['done'] }));
      await flush();
      expect(shown()).toBe('done');

      act(() => registry().release());
      await flush();
      expect(shown()).toBe(CRASH);
    });
  });
});

describe('an app observer with next and error on the proxy, when no preview hides the failure', () => {
  /** Subscribes an observer with two separate callbacks, as app code writes one, and returns what it was told. */
  function observe(actor: UploadActor): string[] {
    const calls: string[] = [];
    actor.subscribe({
      next: (snapshot) => calls.push(`next:${String(snapshot.value)}`),
      error: (error) => calls.push(`error:${(error as Error).message}`),
    });
    return calls;
  }

  test('control: plain XState sends nothing after the error', async () => {
    const actor = createActor(uploadMachine, { clock }).start();
    const calls = observe(actor);

    const reports = catchUnhandledReports();
    actor.send({ type: 'BREAK' });
    expect(await reports.settle()).toEqual([]);

    expect(calls).toEqual([`error:${CRASH}`]);
  });

  test('gets the error last: previews of the failed actor send it nothing', async () => {
    const proxy = connect(createActor(uploadMachine, { clock }).start());
    const calls = observe(proxy);
    const key = keyOf(onlyHandle('upload'));

    // Before the failure, previews reach it.
    act(() => registry().preview(key, { leaves: ['retrying'] }));
    act(() => registry().release());
    expect(calls).toEqual(['next:retrying', 'next:uploading']);

    const reports = catchUnhandledReports();
    proxy.send({ type: 'BREAK' });
    expect(await reports.settle()).toEqual([]);
    expect(calls).toEqual(['next:retrying', 'next:uploading', `error:${CRASH}`]);

    // A failed connect()ed actor stays listed, so it can still be previewed.
    expect(keyOf(onlyHandle('upload'))).toBe(key);
    act(() => registry().preview(key, { leaves: ['done'] }));
    await flush();
    act(() => registry().preview(key, { leaves: ['retrying'] }));
    await flush();
    act(() => registry().release());
    await flush();

    expect(calls).toEqual(['next:retrying', 'next:uploading', `error:${CRASH}`]);
  });
});
