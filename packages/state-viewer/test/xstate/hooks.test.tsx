// The React hooks of state-viewer/xstate against @xstate/react, under StrictMode (see test/setup.ts).
// The tests cover previews in place without remounts, registration, debug options, blocked sends and observers.
// They also cover non-machine logic, errors and Fast Refresh.

import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { assign, createMachine, setup, type AnyActorRef } from 'xstate';
import type { MachineHandle } from '../../src/core/types';
import { createActorContext, useActor, useActorRef, useMachine } from '../../src/xstate';
import { nextInstanceId } from '../../src/xstate/identity';
import { isProxy } from '../../src/xstate/proxy';
import { flush, handlesOf, keyOf, onlyHandle, registry, resetRegistry } from './helpers';

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
