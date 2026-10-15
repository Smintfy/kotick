// The React hooks of state-viewer/xstate against @xstate/react, under StrictMode (see test/setup.ts).
// The tests cover previews in place without remounts, registration, debug options, blocked sends and observers.
// They also cover non-machine logic, errors and Fast Refresh.

import { act, fireEvent, render, screen } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import {
  SimulatedClock,
  assign,
  createActor,
  createMachine,
  fromPromise,
  fromTransition,
  setup,
  type AnyActorLogic,
  type AnyActorRef,
  type AnyMachineSnapshot,
} from 'xstate';
import type { MachineHandle } from '../../src/core/types';
import * as stateViewer from '../../src/xstate';
import { createActorContext, shallowEqual, useActor, useActorRef, useMachine, useSelector } from '../../src/xstate';
import { nextInstanceId } from '../../src/xstate/instance-id';
import { isProxy } from '../../src/xstate/proxy';
import { flush, handlesOf, keyOf, onlyHandle, REACT_MAJOR, registry, resetRegistry } from './helpers';

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

/** The real actor keeps running underneath a preview: `loading` moves on by itself after a second. */
const loaderMachine = createMachine({
  id: 'loader',
  initial: 'loading',
  states: {
    loading: { after: { 1000: 'loaded' } },
    loaded: {},
    failed: { on: { RETRY: 'loading' } },
  },
});

const rowMachine = createMachine({
  id: 'row',
  initial: 'idle',
  states: { idle: { on: { SELECT: 'selected' } }, selected: {} },
});

const greetingMachine = setup({
  types: { input: {} as { name: string }, context: {} as { name: string } },
}).createMachine({
  id: 'greeting',
  context: ({ input }) => ({ name: input.name }),
  initial: 'hello',
  states: { hello: { on: { WAVE: 'bye' } }, bye: {} },
});

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

function blockedEvents() {
  return registry()
    .getSnapshot()
    .log.map(({ instanceKey, event, leaves, blocked }) => ({ instanceKey, event, leaves, blocked }));
}

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
 * XState reports an error no observer handles by throwing it from a `setTimeout` callback. This collects whatever
 * timer callbacks throw while it's installed, instead of letting it reach the test runner as an uncaught error.
 */
function catchTimerErrors() {
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
    errors,
    /** Lets pending timers run, then puts setTimeout back. */
    async settle(): Promise<void> {
      await act(() => new Promise<void>((resolve) => original(resolve, 20)));
      spy.mockRestore();
    },
  };
}

/** The hooks both packages export, for running the same component against each. */
type Hooks = Pick<typeof xstateReact, 'useActor' | 'useActorRef' | 'useSelector' | 'createActorContext'>;

const IMPLEMENTATIONS: [name: string, hooks: Hooks][] = [
  ['@xstate/react', xstateReact],
  ['state-viewer/xstate', stateViewer as unknown as Hooks],
];

/** Previews `leaves` on every instance of `machineId` the moment it registers, the way a deep link does. */
function previewOnRegister(machineId: string, leaves: string[]): void {
  const target = registry();
  const register = target.register;
  vi.spyOn(target, 'register').mockImplementation((handle) => {
    const unregister = register(handle);
    if (handle.machineId === machineId) target.preview(keyOf(handle), { leaves });
    return unregister;
  });
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

describe('useMachine', () => {
  function Toggle({ machine = toggleMachine }: { machine?: typeof toggleMachine }) {
    const [snapshot, send] = useMachine(machine);
    useRenderStats('toggle');
    return (
      <>
        <output data-testid="value">{snapshot.value}</output>
        <output data-testid="flips">{snapshot.context.flips}</output>
        <output data-testid="lit">{String(snapshot.hasTag('lit'))}</output>
        <button type="button" onClick={() => send({ type: 'TOGGLE' })}>
          toggle
        </button>
      </>
    );
  }

  test('shows a preview in place and the real state again on release, without remounting', async () => {
    render(<Toggle />);
    await flush();
    expect(text('value')).toBe('off');
    const handle = onlyHandle('toggle');

    previewOn(handle, ['on']);
    expect(text('value')).toBe('on');
    expect(text('lit')).toBe('true');

    releaseAll();
    expect(text('value')).toBe('off');
    expect(text('lit')).toBe('false');

    // One committed render to mount, one to show the preview and one to release it.
    expect(statsOf('toggle')).toEqual({ mounts: 1, renders: 3 });
  });

  test('the previewed snapshot is a real XState snapshot: matches, hasTag and can work on it', async () => {
    let seen: AnyMachineSnapshot | undefined;
    function Inspect() {
      const [snapshot] = useMachine(toggleMachine);
      seen = snapshot;
      return null;
    }
    render(<Inspect />);
    await flush();

    previewOn(onlyHandle('toggle'), ['on']);
    expect(seen?.value).toBe('on');
    expect(seen?.matches('on')).toBe(true);
    expect(seen?.hasTag('lit')).toBe(true);
    expect(seen?.can({ type: 'TOGGLE' })).toBe(true);
    expect(seen?.status).toBe('active');
  });

  test('blocks events sent through its send while previewing, and delivers them after release', async () => {
    render(<Toggle />);
    await flush();
    const handle = onlyHandle('toggle');
    const button = screen.getByRole('button');

    previewOn(handle, ['on']);
    fireEvent.click(button);
    fireEvent.click(button);
    await flush();
    expect(text('value')).toBe('on');
    expect(blockedEvents()).toEqual([
      { instanceKey: keyOf(handle), event: { type: 'TOGGLE' }, leaves: ['on'], blocked: true },
      { instanceKey: keyOf(handle), event: { type: 'TOGGLE' }, leaves: ['on'], blocked: true },
    ]);

    // The real actor never saw them.
    releaseAll();
    expect(text('value')).toBe('off');
    expect(text('flips')).toBe('0');
    expect(handle.getActiveLeaves()).toEqual(['off']);

    fireEvent.click(button);
    expect(text('value')).toBe('on');
    expect(text('flips')).toBe('1');
    expect(handle.getActiveLeaves()).toEqual(['on']);
    expect(blockedEvents()).toHaveLength(2);
  });

  test('the real actor keeps running during a preview without re-rendering, and release shows where it got to', async () => {
    const clock = new SimulatedClock();
    function Loader() {
      const [snapshot] = useMachine(loaderMachine, { clock });
      useRenderStats('loader');
      return <output data-testid="value">{String(snapshot.value)}</output>;
    }
    render(<Loader />);
    await flush();
    const handle = onlyHandle('loader');

    previewOn(handle, ['failed']);
    expect(text('value')).toBe('failed');
    const rendersWhilePreviewing = statsOf('loader').renders;

    act(() => clock.increment(1000));
    expect(handle.getActiveLeaves()).toEqual(['loaded']);
    expect(text('value')).toBe('failed');
    expect(statsOf('loader').renders).toBe(rendersWhilePreviewing);

    releaseAll();
    expect(text('value')).toBe('loaded');
    expect(statsOf('loader')).toEqual({ mounts: 1, renders: rendersWhilePreviewing + 1 });
  });

  test('a preview applied as the instance registers, as a deep link does, shows without a remount', async () => {
    previewOnRegister('toggle', ['on']);
    render(<Toggle />);
    await flush();

    expect(text('value')).toBe('on');
    expect(registry().getOverride(keyOf(onlyHandle('toggle')))?.requested).toEqual(['on']);
    // React 18's StrictMode runs the mount's effects again in a later commit, which renders once more.
    expect(statsOf('toggle')).toEqual({ mounts: 1, renders: REACT_MAJOR < 19 ? 3 : 2 });

    releaseAll();
    expect(text('value')).toBe('off');
  });

  test('send and the actor ref stay the same objects across renders, previews and releases', async () => {
    const seen: { send: unknown; actorRef: unknown }[] = [];
    function Capture() {
      const [, send, actorRef] = useMachine(toggleMachine);
      // Committed renders only: React 18's StrictMode throws away the first render, and the actor it made.
      React.useLayoutEffect(() => {
        seen.push({ send, actorRef });
      });
      return null;
    }
    render(<Capture />);
    await flush();
    previewOn(onlyHandle('toggle'), ['on']);
    releaseAll();

    expect(seen.length).toBeGreaterThan(2);
    expect(new Set(seen.map(({ send }) => send)).size).toBe(1);
    expect(new Set(seen.map(({ actorRef }) => actorRef)).size).toBe(1);
    expect(isProxy(seen[0].actorRef)).toBe(true);
  });
});

describe('useActor', () => {
  test('shows a preview in place and the real state again on release, without remounting', async () => {
    function Toggle() {
      const [snapshot] = useActor(toggleMachine);
      useRenderStats('toggle');
      return <output data-testid="value">{snapshot.value}</output>;
    }
    render(<Toggle />);
    await flush();

    previewOn(onlyHandle('toggle'), ['on']);
    expect(text('value')).toBe('on');
    releaseAll();
    expect(text('value')).toBe('off');
    expect(statsOf('toggle')).toEqual({ mounts: 1, renders: 3 });
  });

  describe.each(IMPLEMENTATIONS)('matches %s', (_name, hooks) => {
    test('throws when given an actor ref instead of actor logic', () => {
      const actorRef = createActor(toggleMachine);
      function Misused() {
        hooks.useActor(actorRef as unknown as AnyActorLogic);
        return null;
      }
      render(
        <ErrorBoundary>
          <Misused />
        </ErrorBoundary>,
      );
      expect(screen.getByRole('alert').textContent).toBe(
        "useActor() expects actor logic (e.g. a machine), but received an ActorRef. Use the useSelector(actorRef, ...) hook instead to read the ActorRef's snapshot.",
      );
    });

    test('runs a fromTransition reducer', () => {
      const counterLogic = fromTransition(
        (count: number, event: { type: 'INCREMENT' }) => (event.type === 'INCREMENT' ? count + 1 : count),
        0,
      );
      function Counter() {
        const [snapshot, send] = hooks.useActor(counterLogic);
        return (
          <button type="button" onClick={() => send({ type: 'INCREMENT' })}>
            {snapshot.context}
          </button>
        );
      }
      render(<Counter />);
      const button = screen.getByRole('button');
      expect(button.textContent).toBe('0');
      fireEvent.click(button);
      fireEvent.click(button);
      expect(button.textContent).toBe('2');
    });

    /** Renders a machine whose BREAK action throws, sends BREAK, and returns what XState reported as unhandled. */
    async function breakWhileRunning(): Promise<unknown[]> {
      const fragileMachine = createMachine({
        id: 'fragile',
        initial: 'ok',
        states: {
          ok: {
            on: {
              BREAK: {
                actions: () => {
                  throw new Error('Broken on purpose');
                },
              },
            },
          },
        },
      });
      function Fragile() {
        const [snapshot, send] = hooks.useActor(fragileMachine);
        return (
          <button type="button" onClick={() => send({ type: 'BREAK' })}>
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
      const timers = catchTimerErrors();
      fireEvent.click(screen.getByRole('button'));
      await timers.settle();
      return timers.errors;
    }

    /** Renders a machine whose entry action throws, and returns what XState reported as unhandled. */
    async function breakOnStart(): Promise<unknown[]> {
      const brokenMachine = createMachine({
        id: 'broken',
        entry: () => {
          throw new Error('Broken on start');
        },
      });
      function Broken() {
        hooks.useActor(brokenMachine);
        return <p>rendered</p>;
      }
      const timers = catchTimerErrors();
      render(
        <ErrorBoundary>
          <Broken />
        </ErrorBoundary>,
      );
      await timers.settle();
      return timers.errors;
    }

    test('throws an error the running actor runs into to the nearest error boundary', async () => {
      await breakWhileRunning();
      expect(screen.getByRole('alert').textContent).toBe('Broken on purpose');
    });

    test('throws an error raised while the actor starts to the nearest error boundary', async () => {
      await breakOnStart();
      expect(screen.getByRole('alert').textContent).toBe('Broken on start');
    });

    test('an error the running actor runs into is not also reported as unhandled', async () => {
      // With @xstate/react every observer of the actor has an error callback, so XState doesn't throw it globally.
      expect(await breakWhileRunning()).toEqual([]);
    });

    test('an error raised while the actor starts is not also reported as unhandled', async () => {
      // @xstate/react's useActor subscribes before starting the actor, so the error has an observer to go to.
      expect(await breakOnStart()).toEqual([]);
    });
  });

  test('throws the same error for an actor ref made by state-viewer as for a plain one', () => {
    let proxied: AnyActorRef | undefined;
    function Source() {
      proxied = useActorRef(toggleMachine);
      return null;
    }
    render(<Source />);
    function Misused() {
      useActor(proxied as unknown as AnyActorLogic);
      return null;
    }
    render(
      <ErrorBoundary>
        <Misused />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/^useActor\(\) expects actor logic/);
  });

  test('leaves non-machine logic unregistered and unproxied', async () => {
    const counterLogic = fromTransition((count: number) => count + 1, 0);
    let actorRef: AnyActorRef | undefined;
    function Counter() {
      const [, , ref] = useActor(counterLogic);
      actorRef = ref;
      return null;
    }
    render(<Counter />);
    await flush();
    expect(registry().getSnapshot().machines).toEqual([]);
    expect(isProxy(actorRef)).toBe(false);
  });
});

describe('useActorRef', () => {
  test('consumers reading through useSelector show a preview in place and the real state on release', async () => {
    function Toggle() {
      const actorRef = useActorRef(toggleMachine);
      return (
        <>
          <Value actorRef={actorRef} />
          <Flips actorRef={actorRef} />
        </>
      );
    }
    function Value({ actorRef }: { actorRef: ReturnType<typeof useActorRef<typeof toggleMachine>> }) {
      const value = useSelector(actorRef, (snapshot) => snapshot.value);
      useRenderStats('value');
      return <output data-testid="value">{value}</output>;
    }
    function Flips({ actorRef }: { actorRef: ReturnType<typeof useActorRef<typeof toggleMachine>> }) {
      // A new object per selection, which shallowEqual keeps from counting as a change.
      const { flips } = useSelector(actorRef, (snapshot) => ({ flips: snapshot.context.flips }), shallowEqual);
      useRenderStats('flips');
      return <output data-testid="flips">{flips}</output>;
    }
    render(<Toggle />);
    await flush();

    previewOn(onlyHandle('toggle'), ['on']);
    expect(text('value')).toBe('on');
    releaseAll();
    expect(text('value')).toBe('off');

    expect(statsOf('value')).toEqual({ mounts: 1, renders: 3 });
    // The preview uses the live context, so the selected count never changed and Flips never re-rendered.
    expect(statsOf('flips')).toEqual({ mounts: 1, renders: 1 });
  });

  test('blocks actorRef.send while previewing, and delivers after release', async () => {
    let actorRef: ReturnType<typeof useActorRef<typeof toggleMachine>> | undefined;
    function Toggle() {
      const ref = useActorRef(toggleMachine);
      actorRef = ref;
      const value = useSelector(ref, (snapshot) => snapshot.value);
      return <output data-testid="value">{value}</output>;
    }
    render(<Toggle />);
    await flush();
    const handle = onlyHandle('toggle');

    previewOn(handle, ['on']);
    act(() => actorRef?.send({ type: 'TOGGLE' }));
    expect(blockedEvents()).toEqual([
      { instanceKey: keyOf(handle), event: { type: 'TOGGLE' }, leaves: ['on'], blocked: true },
    ]);

    releaseAll();
    expect(text('value')).toBe('off');
    act(() => actorRef?.send({ type: 'TOGGLE' }));
    expect(text('value')).toBe('on');
    expect(blockedEvents()).toHaveLength(1);
  });

  test('its observer gets the snapshots @xstate/react gives it when the actor starts', async () => {
    const delivered: Record<string, unknown[]> = {};
    for (const [name, hooks] of IMPLEMENTATIONS) {
      const listener = vi.fn();
      function Observed() {
        hooks.useActorRef(toggleMachine, undefined, listener);
        return null;
      }
      const { unmount } = render(<Observed />);
      await flush();
      delivered[name] = listener.mock.calls.map(([snapshot]) => (snapshot as AnyMachineSnapshot).value);
      unmount();
    }
    expect(delivered['state-viewer/xstate']).toEqual(delivered['@xstate/react']);
    expect(delivered['@xstate/react']?.length).toBeGreaterThan(0);
  });

  test('its observer gets the preview when one starts and the real snapshot on release', async () => {
    const clock = new SimulatedClock();
    const listener = vi.fn();
    let actorRef: AnyActorRef | undefined;
    function Observed() {
      actorRef = useActorRef(loaderMachine, { clock }, listener);
      return null;
    }
    render(<Observed />);
    await flush();
    const handle = onlyHandle('loader');
    listener.mockClear();

    previewOn(handle, ['failed']);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.lastCall?.[0]).toBe(actorRef?.getSnapshot());
    expect(listener.mock.lastCall?.[0].value).toBe('failed');

    // A real update during the preview doesn't change what's shown, so it isn't passed on.
    act(() => clock.increment(1000));
    expect(listener).toHaveBeenCalledTimes(1);

    releaseAll();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.lastCall?.[0].value).toBe('loaded');
    expect(listener.mock.lastCall?.[0]).toBe(actorRef?.getSnapshot());
  });

  test('its observer gets a preview applied as the actor registers', async () => {
    previewOnRegister('toggle', ['on']);
    const listener = vi.fn();
    let actorRef: AnyActorRef | undefined;
    function Observed() {
      actorRef = useActorRef(toggleMachine, undefined, listener);
      return null;
    }
    render(<Observed />);
    await flush();

    expect(listener.mock.lastCall?.[0].value).toBe('on');
    expect(listener.mock.lastCall?.[0]).toBe(actorRef?.getSnapshot());
  });

  test('its observer object gets real updates as they happen when nothing is previewed', async () => {
    const next = vi.fn();
    let actorRef: ReturnType<typeof useActorRef<typeof toggleMachine>> | undefined;
    const observer = { next };
    function Observed() {
      actorRef = useActorRef(toggleMachine, undefined, observer);
      return null;
    }
    render(<Observed />);
    await flush();
    next.mockClear();

    act(() => actorRef?.send({ type: 'TOGGLE' }));
    act(() => actorRef?.send({ type: 'TOGGLE' }));
    expect(next.mock.calls.map(([snapshot]) => snapshot.value)).toEqual(['on', 'off']);
  });

  describe.each(IMPLEMENTATIONS)('matches %s', (_name, hooks) => {
    test('runs fromPromise logic read with useSelector', async () => {
      let resolve: (value: string) => void = () => {};
      const promise = new Promise<string>((done) => {
        resolve = done;
      });
      const loadLogic = fromPromise(() => promise);
      function Load() {
        const actorRef = hooks.useActorRef(loadLogic);
        const status = hooks.useSelector(actorRef, (snapshot) => snapshot.status);
        const output = hooks.useSelector(actorRef, (snapshot) => snapshot.output);
        return <output data-testid="load">{`${status}:${output ?? ''}`}</output>;
      }
      render(<Load />);
      expect(text('load')).toBe('active:');
      await act(async () => resolve('loaded'));
      expect(text('load')).toBe('done:loaded');
    });
  });

  test('leaves fromPromise logic unregistered and unproxied', async () => {
    const loadLogic = fromPromise(async () => 'loaded');
    let actorRef: AnyActorRef | undefined;
    function Load() {
      actorRef = useActorRef(loadLogic);
      return null;
    }
    render(<Load />);
    await flush();
    expect(registry().getSnapshot().machines).toEqual([]);
    expect(isProxy(actorRef)).toBe(false);
  });
});

describe('createActorContext', () => {
  test('the Provider, its useSelector and its useActorRef all show a preview in place and release it', async () => {
    const ToggleContext = createActorContext(toggleMachine);
    function Value() {
      const value = ToggleContext.useSelector((snapshot) => snapshot.value);
      useRenderStats('value');
      return <output data-testid="value">{value}</output>;
    }
    function Lit() {
      const actorRef = ToggleContext.useActorRef();
      const lit = useSelector(actorRef, (snapshot) => snapshot.hasTag('lit'));
      useRenderStats('lit');
      return (
        <button type="button" onClick={() => actorRef.send({ type: 'TOGGLE' })}>
          {String(lit)}
        </button>
      );
    }
    function Static() {
      useRenderStats('static');
      return null;
    }
    render(
      <ToggleContext.Provider>
        <Value />
        <Lit />
        <Static />
      </ToggleContext.Provider>,
    );
    await flush();
    const handle = onlyHandle('toggle');

    previewOn(handle, ['on']);
    expect(text('value')).toBe('on');
    expect(screen.getByRole('button').textContent).toBe('true');

    fireEvent.click(screen.getByRole('button'));
    expect(blockedEvents()).toEqual([
      { instanceKey: keyOf(handle), event: { type: 'TOGGLE' }, leaves: ['on'], blocked: true },
    ]);

    releaseAll();
    expect(text('value')).toBe('off');
    expect(screen.getByRole('button').textContent).toBe('false');

    expect(statsOf('value')).toEqual({ mounts: 1, renders: 3 });
    expect(statsOf('lit')).toEqual({ mounts: 1, renders: 3 });
    // The Provider doesn't re-render on state changes, so children that don't read the actor don't either.
    expect(statsOf('static')).toEqual({ mounts: 1, renders: 1 });
  });

  test('a consumer that mounts during a preview shows it from its first render', async () => {
    const ToggleContext = createActorContext(toggleMachine);
    const firstValues: string[] = [];
    function Late() {
      const value = ToggleContext.useSelector((snapshot) => snapshot.value);
      const first = React.useRef(value);
      React.useEffect(() => {
        firstValues.push(first.current);
      }, []);
      return <output data-testid="late">{value}</output>;
    }
    const { rerender } = render(<ToggleContext.Provider>{null}</ToggleContext.Provider>);
    await flush();

    previewOn(onlyHandle('toggle'), ['on']);
    rerender(
      <ToggleContext.Provider>
        <Late />
      </ToggleContext.Provider>,
    );
    expect(text('late')).toBe('on');
    expect(new Set(firstValues)).toEqual(new Set(['on']));
  });

  test('Provider options are merged over the context options, debug included, and debug never reaches XState', async () => {
    const GreetingContext = createActorContext(greetingMachine, {
      input: { name: 'Ada' },
      debug: { id: 'greeting-base', label: 'Base' },
    });
    let actorRef: AnyActorRef | undefined;
    function Name() {
      actorRef = GreetingContext.useActorRef();
      const name = GreetingContext.useSelector((snapshot) => snapshot.context.name);
      return <output data-testid="name">{name}</output>;
    }
    render(
      <GreetingContext.Provider options={{ input: { name: 'Grace' }, debug: { id: 'greeting-provided' } }}>
        <Name />
      </GreetingContext.Provider>,
    );
    await flush();

    expect(text('name')).toBe('Grace');
    // The Provider's debug replaces the context's as a whole, as any other option does.
    expect(handlesOf('greeting-base')).toEqual([]);
    const handle = onlyHandle('greeting-provided');
    expect(handle.label).toBeUndefined();
    expect((actorRef as unknown as { options: object }).options).not.toHaveProperty('debug');
    expect((actorRef as unknown as { options: object }).options).toMatchObject({ input: { name: 'Grace' } });
  });

  test('the Provider logic prop replaces the context logic', async () => {
    const ToggleContext = createActorContext(toggleMachine);
    const otherToggle = createMachine({
      id: 'other-toggle',
      initial: 'on',
      context: { flips: 0 },
      states: { off: {}, on: {} },
    }) as unknown as typeof toggleMachine;
    function Value() {
      return <output data-testid="value">{ToggleContext.useSelector((snapshot) => snapshot.value)}</output>;
    }
    render(
      <ToggleContext.Provider logic={otherToggle}>
        <Value />
      </ToggleContext.Provider>,
    );
    await flush();

    expect(text('value')).toBe('on');
    expect(handlesOf('toggle')).toEqual([]);
    const handle = onlyHandle('other-toggle');
    expect(handle.source).toBe(otherToggle.config);

    previewOn(handle, ['off']);
    expect(text('value')).toBe('off');
  });

  describe.each(IMPLEMENTATIONS)('matches %s', (_name, hooks) => {
    test('throws for the deprecated machine prop', () => {
      const ToggleContext = hooks.createActorContext(toggleMachine);
      const Provider = ToggleContext.Provider as unknown as React.ComponentType<{
        machine: unknown;
        children?: React.ReactNode;
      }>;
      render(
        <ErrorBoundary>
          <Provider machine={toggleMachine} />
        </ErrorBoundary>,
      );
      expect(screen.getByRole('alert').textContent).toBe(
        'The "machine" prop has been deprecated. Please use "logic" instead.',
      );
    });

    test('throws when its hooks are used outside the Provider', () => {
      const ToggleContext = hooks.createActorContext(toggleMachine);
      function Orphan() {
        ToggleContext.useSelector((snapshot) => snapshot.value);
        return null;
      }
      render(
        <ErrorBoundary>
          <Orphan />
        </ErrorBoundary>,
      );
      expect(screen.getByRole('alert').textContent).toBe(
        'You used a hook from "ActorProvider" but it\'s not inside a <ActorProvider> component.',
      );
    });
  });
});

describe('registration', () => {
  function Toggle() {
    useMachine(toggleMachine);
    return null;
  }

  test('registers one handle per mounted hook under StrictMode, and removes it after unmount', async () => {
    const { unmount } = render(<Toggle />);
    await flush();
    const handle = onlyHandle('toggle');
    expect(handle).toMatchObject({ machineId: 'toggle', adapter: 'xstate' });
    // The config object itself, which fixtures match by identity; toMatchObject would accept a structural copy.
    expect(handle.source).toBe(toggleMachine.config);
    expect(handle.getActiveLeaves()).toEqual(['off']);

    unmount();
    await flush();
    expect(registry().getSnapshot().machines).toEqual([]);
  });

  test('every hook kind registers its machine', async () => {
    const ToggleContext = createActorContext(toggleMachine, { debug: { id: 'from-context' } });
    function ViaActor() {
      useActor(toggleMachine, { debug: { id: 'from-use-actor' } });
      return null;
    }
    function ViaActorRef() {
      useActorRef(toggleMachine, { debug: { id: 'from-use-actor-ref' } });
      return null;
    }
    render(
      <>
        <Toggle />
        <ViaActor />
        <ViaActorRef />
        <ToggleContext.Provider>{null}</ToggleContext.Provider>
      </>,
    );
    await flush();
    expect(registry().getSnapshot().machines.map(({ machineId }) => machineId)).toEqual([
      'toggle',
      'from-use-actor',
      'from-use-actor-ref',
      'from-context',
    ]);
  });

  test('instances of one machine get distinct keys in registration order, and removing one leaves the others', async () => {
    function Row({ name }: { name: string }) {
      const [snapshot] = useMachine(rowMachine, { debug: { label: name } });
      useRenderStats(name);
      return <li data-testid={name}>{String(snapshot.value)}</li>;
    }
    function List({ rows }: { rows: string[] }) {
      return (
        <ul>
          {rows.map((name) => (
            <Row key={name} name={name} />
          ))}
        </ul>
      );
    }
    const { rerender } = render(<List rows={['a', 'b', 'c']} />);
    await flush();

    const handles = handlesOf('row');
    expect(handles.map(({ label }) => label)).toEqual(['a', 'b', 'c']);
    const keys = handles.map(keyOf);
    expect(new Set(keys).size).toBe(3);

    previewOn(handles[1], ['selected']);
    expect([text('a'), text('b'), text('c')]).toEqual(['idle', 'selected', 'idle']);
    // Only the previewed row re-rendered.
    expect([statsOf('a').renders, statsOf('b').renders, statsOf('c').renders]).toEqual([1, 2, 1]);

    rerender(<List rows={['a', 'c']} />);
    await flush();
    expect(handlesOf('row').map(keyOf)).toEqual([keys[0], keys[2]]);
    expect(handlesOf('row').map(({ label }) => label)).toEqual(['a', 'c']);
    // The removed row's preview goes with it.
    expect(registry().getSnapshot().overrides).toEqual({});
    expect([statsOf('a').mounts, statsOf('c').mounts]).toEqual([1, 1]);
  });

  test('records the real snapshots the actor goes through', async () => {
    let send: ((event: ToggleEvent) => void) | undefined;
    function Recorded() {
      [, send] = useMachine(toggleMachine);
      return null;
    }
    render(<Recorded />);
    await flush();
    expect([...(registry().getSnapshot().data.toggle?.recorded ?? [])]).toEqual(['off']);

    act(() => send?.({ type: 'TOGGLE' }));
    act(() => send?.({ type: 'TOGGLE' }));
    await flush();
    expect([...(registry().getSnapshot().data.toggle?.recorded ?? [])].sort()).toEqual(['off', 'on']);

    // A preview of a visited state uses the context it had there, without the live-context warning.
    const handle = onlyHandle('toggle');
    warn.mockClear();
    act(() => registry().preview(keyOf(handle), { leaves: ['on'] }));
    expect(registry().getOverride(keyOf(handle))).toMatchObject({ source: 'recorded', context: { flips: 1 } });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('instance ids', () => {
  test('come from the page-wide counter: distinct per hook and across roots, and stable across re-renders', async () => {
    function Toggle({ label }: { label: string }) {
      useMachine(toggleMachine, { debug: { label } });
      return null;
    }
    // Draws from the counter on both sides of the renders, so the ids must fall strictly between the two, whatever
    // values earlier tests (or StrictMode's double-invoked initializers) used up.
    const floor = Number(nextInstanceId());
    // Each render() is a root of its own, as two islands or widgets on one page are.
    const pair = render(
      <>
        <Toggle label="a" />
        <Toggle label="b" />
      </>,
    );
    const single = render(<Toggle label="c" />);
    await flush();
    const ceiling = Number(nextInstanceId());
    const ids = handlesOf('toggle').map(({ instanceId }) => instanceId);
    expect(handlesOf('toggle').map(({ label }) => label)).toEqual(['a', 'b', 'c']);
    // Digit strings from the counter, which React's useId values never are.
    for (const id of ids) {
      expect(id).toMatch(/^\d+$/);
      expect(Number(id)).toBeGreaterThan(floor);
      expect(Number(id)).toBeLessThan(ceiling);
    }
    expect(new Set(ids).size).toBe(3);

    // A re-render of either root relabels each instance, and keeps its id.
    pair.rerender(
      <>
        <Toggle label="A" />
        <Toggle label="B" />
      </>,
    );
    single.rerender(<Toggle label="C" />);
    await flush();
    expect(handlesOf('toggle').map(({ label }) => label)).toEqual(['A', 'B', 'C']);
    expect(handlesOf('toggle').map(({ instanceId }) => instanceId)).toEqual(ids);
  });

  test('stay the same across re-renders, and differ between components and across remounts', async () => {
    function Toggle({ label }: { label: string }) {
      const [snapshot] = useMachine(toggleMachine);
      return <output data-testid={label}>{snapshot.value}</output>;
    }
    const { rerender } = render(
      <>
        <Toggle key="first" label="one" />
        <Toggle key="second" label="two" />
      </>,
    );
    await flush();
    const [first, second] = handlesOf('toggle');
    expect(first.instanceId).not.toBe(second.instanceId);

    rerender(
      <>
        <Toggle key="first" label="uno" />
        <Toggle key="second" label="dos" />
      </>,
    );
    await flush();
    const [firstAgain, secondAgain] = handlesOf('toggle');
    expect(firstAgain).toBe(first);
    expect(secondAgain).toBe(second);

    rerender(
      <>
        <Toggle key="first" label="uno" />
        <Toggle key="third" label="tres" />
      </>,
    );
    await flush();
    const [stillFirst, third] = handlesOf('toggle');
    expect(stillFirst).toBe(first);
    expect(third.instanceId).not.toBe(second.instanceId);
  });
});

describe('debug options', () => {
  test('debug.id replaces the machine id and debug.label names the instance', async () => {
    function Toggle() {
      useMachine(toggleMachine, { debug: { id: 'switch', label: 'Hall light' } });
      return null;
    }
    render(<Toggle />);
    await flush();
    expect(handlesOf('toggle')).toEqual([]);
    const handle = onlyHandle('switch');
    expect(handle).toMatchObject({ machineId: 'switch', label: 'Hall light' });
    expect(handle.source).toBe(toggleMachine.config);
  });

  test('a debug.label that changes between renders relabels the instance in place', async () => {
    function Toggle({ label }: { label: string }) {
      const [snapshot] = useMachine(toggleMachine, { debug: { label } });
      useRenderStats('toggle');
      return <output data-testid="value">{snapshot.value}</output>;
    }
    const { rerender } = render(<Toggle label="Before" />);
    await flush();
    const before = onlyHandle('toggle');
    previewOn(before, ['on']);

    rerender(<Toggle label="After" />);
    await flush();
    const after = onlyHandle('toggle');
    expect(after.label).toBe('After');
    expect(keyOf(after)).toBe(keyOf(before));
    expect(registry().getOverride(keyOf(after))?.requested).toEqual(['on']);
    expect(text('value')).toBe('on');
    expect(statsOf('toggle').mounts).toBe(1);
  });

  test('the actor ref stays the same object when only debug.label changes', async () => {
    const actorRefs = new Set<unknown>();
    const actors = new Set<unknown>();
    function Toggle({ label }: { label: string }) {
      const [, , actorRef] = useMachine(toggleMachine, { debug: { label } });
      // Committed renders only: React 18's StrictMode throws away the first render, and the actor it made.
      React.useLayoutEffect(() => {
        actorRefs.add(actorRef);
        // XState's `ref` is the real actor itself; the proxy passes it through.
        actors.add(actorRef.ref);
      });
      return null;
    }
    const { rerender } = render(<Toggle label="Before" />);
    await flush();
    rerender(<Toggle label="After" />);
    await flush();

    expect(actors.size).toBe(1);
    // @xstate/react gives one ref for the life of the actor, and the adapter keeps one proxy per real actor.
    expect(actorRefs.size).toBe(1);
  });

  test('debug.disabled leaves the actor unregistered and unproxied, and its sends go straight through', async () => {
    let actorRef: AnyActorRef | undefined;
    function Toggle() {
      const [snapshot, send, ref] = useMachine(toggleMachine, { debug: { disabled: true } });
      actorRef = ref;
      return (
        <button type="button" onClick={() => send({ type: 'TOGGLE' })}>
          {snapshot.value}
        </button>
      );
    }
    render(<Toggle />);
    await flush();

    expect(registry().getSnapshot().machines).toEqual([]);
    expect(isProxy(actorRef)).toBe(false);
    expect((actorRef as unknown as { options: object }).options).not.toHaveProperty('debug');
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').textContent).toBe('on');
  });

  test('debug.disabled works through useActorRef too', async () => {
    let actorRef: AnyActorRef | undefined;
    function Toggle() {
      actorRef = useActorRef(toggleMachine, { debug: { disabled: true } });
      return null;
    }
    render(<Toggle />);
    await flush();
    expect(registry().getSnapshot().machines).toEqual([]);
    expect(isProxy(actorRef)).toBe(false);
  });

  test('the debug key never reaches XState, while the other options do', async () => {
    let actorRef: AnyActorRef | undefined;
    function Greeting() {
      const [snapshot, , ref] = useMachine(greetingMachine, {
        input: { name: 'Ada' },
        id: 'greeter',
        debug: { id: 'greeting-debug', label: 'Greeter' },
      });
      actorRef = ref;
      return <output data-testid="name">{snapshot.context.name}</output>;
    }
    render(<Greeting />);
    await flush();

    expect(text('name')).toBe('Ada');
    const options = (actorRef as unknown as { options: Record<string, unknown> }).options;
    expect(options).not.toHaveProperty('debug');
    expect(options).toMatchObject({ input: { name: 'Ada' }, id: 'greeter' });
    expect(actorRef?.id).toBe('greeter');
    expect(onlyHandle('greeting-debug').label).toBe('Greeter');
  });
});

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
