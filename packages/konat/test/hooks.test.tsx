import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { Konat } from 'konat';
import { createActorContext, shallowEqual, useActor, useActorRef, useMachine, useSelector } from 'konat/xstate';
import { describe, expect, test } from 'vitest';
import {
  assign,
  createActor,
  createMachine,
  fromPromise,
  fromTransition,
  setup,
  type ActorRefFrom,
  type AnyActorRef,
  type AnyMachineSnapshot,
  type AnyStateMachine,
} from 'xstate';
import { press } from './support/app';
import { alerts, Boundary } from './support/boundary';
import { uncaught } from './support/console';
import { IMPLEMENTATIONS, REACT_MAJOR } from './support/hooks';
import {
  blockedEvents,
  flush,
  freshId,
  instances,
  machines,
  overlay,
  panel,
  preview,
  release,
  show,
} from './support/panel';

type Flips = { flips: number };

type ToggleEvent = { type: 'TOGGLE' };

function createToggleMachine() {
  // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
  return setup({
    types: { context: {} as Flips, events: {} as ToggleEvent },
    actions: { flip: assign({ flips: ({ context }) => context.flips + 1 }) },
  }).createMachine({
    id: freshId('toggle'),
    context: { flips: 0 },
    initial: 'off',
    states: {
      off: { on: { TOGGLE: { target: 'on', actions: 'flip' } } },
      on: { tags: ['lit'], on: { TOGGLE: { target: 'off', actions: 'flip' } } },
    },
  });
}

type ToggleMachine = ReturnType<typeof createToggleMachine>;

type LoaderEvent = { type: 'LOADED' };

function createLoaderMachine() {
  // SAFETY: XState reads the types of setup() only at compile time. It never reads this value.
  return setup({ types: { events: {} as LoaderEvent } }).createMachine({
    id: freshId('loader'),
    initial: 'loading',
    states: { loading: { on: { LOADED: 'loaded' } }, loaded: {}, failed: {} },
  });
}

/**
 * The system id of the loader's actor.
 * Another actor of the app sends to it by this id.
 */
const LOADER = 'loader';

function Toggle({ machine }: { machine: ToggleMachine }) {
  const [snapshot, send] = useMachine(machine);

  return (
    <>
      <output aria-label="toggle">{JSON.stringify({ value: snapshot.value, flips: snapshot.context.flips })}</output>
      <button type="button" onClick={() => send({ type: 'TOGGLE' })}>
        Toggle
      </button>
    </>
  );
}

type Commits<T> = { mounts: number; renders: T[] };

function commitsOf<T>(): Commits<T> {
  return { mounts: 0, renders: [] };
}

/**
 * Counts the mounts of a component, and keeps `value` from each render that React commits.
 * StrictMode runs the layout effects of a mount twice with the same closure, so the render object tells the runs apart.
 * A remount makes new refs, so it counts as a mount.
 */
function useCommits<T>(commits: Commits<T>, value: T): void {
  const mounted = React.useRef(false);
  const committed = React.useRef<object | null>(null);
  const render = {};
  React.useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      commits.mounts += 1;
    }

    if (committed.current === render) return;
    committed.current = render;
    commits.renders.push(value);
  });
}

function shown(name = 'toggle') {
  return JSON.parse(screen.getByRole('status', { name }).textContent ?? 'null');
}

/**
 * Clears the blocked-event log, which the page keeps for the whole file.
 * The Clear button is on a machine page, so call show() first.
 */
async function clearBlockedEvents(): Promise<void> {
  const clear = [...overlay().querySelectorAll('button')].find((button) => button.textContent === 'Clear');

  if (!clear) throw new Error('The panel has no Clear button.');
  fireEvent.click(clear);
  await flush();
}

test('useMachine drives a component', async () => {
  render(<Toggle machine={createToggleMachine()} />);

  const before = shown();
  await press('Toggle');
  expect({ before, after: shown() }).toEqual({ before: { value: 'off', flips: 0 }, after: { value: 'on', flips: 1 } });
});

describe('useMachine and useActor', () => {
  test.each<[string, typeof useMachine]>([
    ['useMachine', useMachine],
    ['useActor', useActor],
  ])('%s shows a preview in place as a real snapshot, and the real state on release, without a remount', async (_, useHook) => {
    const machine = createToggleMachine();
    const commits = commitsOf<string>();

    function Lamp() {
      const [snapshot] = useHook(machine);
      useCommits(commits, String(snapshot.value));

      const seen = {
        value: snapshot.value,
        lit: snapshot.hasTag('lit'),
        on: snapshot.matches('on'),
        canToggle: snapshot.can({ type: 'TOGGLE' }),
        status: snapshot.status,
      };

      return <output aria-label="toggle">{JSON.stringify(seen)}</output>;
    }

    render(
      <>
        <Lamp />
        <Konat defaultOpen />
      </>,
    );
    await flush();

    await preview(machine.id, ['on']);
    const previewed = shown();
    await release(machine.id);
    expect({ previewed, released: shown(), commits }).toEqual({
      previewed: { value: 'on', lit: true, on: true, canToggle: true, status: 'active' },
      released: { value: 'off', lit: false, on: false, canToggle: true, status: 'active' },
      commits: { mounts: 1, renders: ['off', 'on', 'off'] },
    });
  });

  test('the actor moves on during a preview without a render, and the release shows where it got to', async () => {
    const machine = createLoaderMachine();
    const commits = commitsOf<string>();

    function Loader() {
      const [snapshot, , actorRef] = useMachine(machine, { systemId: LOADER });
      useCommits(commits, String(snapshot.value));

      return (
        <>
          <output aria-label="loader">{JSON.stringify(snapshot.value)}</output>
          {/* The system holds the actor itself, so a preview doesn't block this event. */}
          <button type="button" onClick={() => actorRef.system.get(LOADER)?.send({ type: 'LOADED' })}>
            Finish loading
          </button>
        </>
      );
    }

    render(
      <>
        <Loader />
        <Konat defaultOpen />
      </>,
    );
    await flush();

    await preview(machine.id, ['failed']);
    await press('Finish loading');
    const previewing = { shown: shown('loader'), live: panel().live, renders: [...commits.renders] };
    await release(machine.id);
    expect({ previewing, released: shown('loader'), commits }).toEqual({
      previewing: { shown: 'failed', live: ['loaded'], renders: ['loading', 'failed'] },
      released: 'loaded',
      commits: { mounts: 1, renders: ['loading', 'failed', 'loaded'] },
    });
  });

  test('a deep link previews as the hook registers, without a remount', async () => {
    const machine = createToggleMachine();
    const commits = commitsOf<string>();

    function Lamp() {
      const [snapshot] = useMachine(machine);
      useCommits(commits, String(snapshot.value));

      return <output aria-label="toggle">{JSON.stringify(snapshot.value)}</output>;
    }

    window.history.replaceState(null, '', `/?debug-state=${machine.id}:on`);
    render(
      <>
        <Lamp />
        <Konat defaultOpen />
      </>,
    );
    await flush();
    await show(machine.id);

    const linked = { shown: shown(), previewed: panel().previewed, commits: structuredClone(commits) };
    await release(machine.id);
    expect({ linked, released: shown() }).toEqual({
      linked: {
        shown: 'on',
        previewed: ['on'],
        // React 18's StrictMode runs the effects of the mount again in a later commit, which renders once more.
        commits: { mounts: 1, renders: REACT_MAJOR < 19 ? ['off', 'on', 'on'] : ['off', 'on'] },
      },
      released: 'off',
    });
  });

  describe.each(IMPLEMENTATIONS)('like @xstate/react, with %s', (_, hooks, previews) => {
    test('send and the actor ref stay the same through new debug options, a preview and its release, so effects that depend on them run once', async () => {
      type Loads = { loads: number };

      type InboxEvent = { type: 'LOAD' };

      // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
      const machine = setup({
        types: { context: {} as Loads, events: {} as InboxEvent },
      }).createMachine({
        id: freshId('inbox'),
        context: { loads: 0 },
        initial: 'idle',
        states: { idle: { on: { LOAD: { actions: assign({ loads: ({ context }) => context.loads + 1 }) } } }, failed: {} },
      });

      const commits = commitsOf<{ send: unknown; actorRef: unknown; loads: number }>();

      function Inbox({ debug }: { debug: { label?: string; id?: string } }) {
        // SAFETY: The types of @xstate/react have no debug option. Its hooks give debug to XState, which ignores it.
        const [snapshot, send, actorRef] = hooks.useMachine(machine, { debug } as never);
        useCommits(commits, { send, actorRef, loads: snapshot.context.loads });
        // An app loads on mount in an effect that depends on send, so a new send loads again.
        React.useEffect(() => {
          send({ type: 'LOAD' });
        }, [send]);

        return <output aria-label="inbox">{JSON.stringify(snapshot.context)}</output>;
      }

      const app = (debug: { label?: string; id?: string }) => (
        <>
          <Inbox debug={debug} />
          <Konat defaultOpen />
        </>
      );

      const view = render(app({ label: 'Inbox' }));
      await flush();

      view.rerender(app({ label: 'Inbox (3 unread)' }));
      await flush();

      if (previews) {
        await preview(machine.id, ['failed']);
        await release(machine.id);
      }

      view.rerender(app({ label: 'Inbox (3 unread)', id: freshId('mail') }));
      await flush();
      const { mounts, renders } = commits;
      expect({
        mounts,
        loads: renders.map(({ loads }) => loads),
        sends: new Set(renders.map(({ send }) => send)).size,
        actorRefs: new Set(renders.map(({ actorRef }) => actorRef)).size,
      }).toEqual({
        mounts: 1,
        // StrictMode runs the effects of a mount twice, so the mount loads twice.
        // The preview and the release render two more times.
        // On React 18, the loads during StrictMode's second run of the effects make the hook render once more.
        loads: previews ? [0, 2, ...(REACT_MAJOR < 19 ? [2] : []), 2, 2, 2, 2] : [0, 2, 2, 2],
        sends: 1,
        actorRefs: 1,
      });
    });

    test('useActor runs a fromTransition reducer', () => {
      const counter = fromTransition((count: number, event: { type: 'INCREMENT' }) => {
        return event.type === 'INCREMENT' ? count + 1 : count;
      }, 0);

      function Counter() {
        const [snapshot, send] = hooks.useActor(counter);

        return (
          <>
            <output aria-label="count">{snapshot.context}</output>
            <button type="button" onClick={() => send({ type: 'INCREMENT' })}>
              Increment
            </button>
          </>
        );
      }

      render(<Counter />);

      const before = shown('count');
      fireEvent.click(screen.getByRole('button', { name: 'Increment' }));
      fireEvent.click(screen.getByRole('button', { name: 'Increment' }));
      expect({ before, after: shown('count') }).toEqual({ before: 0, after: 2 });
    });

    test('useActor throws when given an actor ref, a plain one or one from useActorRef, in place of actor logic', () => {
      const machine = createToggleMachine();
      const plain = createActor(machine);

      function Misused({ actorRef }: { actorRef: AnyActorRef }) {
        // @ts-expect-error useActor takes actor logic, and this test gives it an actor ref.
        hooks.useActor(actorRef);

        return null;
      }

      function FromHook() {
        const actorRef = hooks.useActorRef(machine);

        return (
          <Boundary>
            <Misused actorRef={actorRef} />
          </Boundary>
        );
      }

      render(
        <>
          <Boundary>
            <Misused actorRef={plain} />
          </Boundary>
          <FromHook />
        </>,
      );

      const message =
        "useActor() expects actor logic (e.g. a machine), but received an ActorRef. Use the useSelector(actorRef, ...) hook instead to read the ActorRef's snapshot.";

      expect(alerts()).toEqual([message, message]);
    });

    test('an error that the running actor runs into goes to the nearest error boundary, and is not reported as unhandled', async () => {
      const machine = createMachine({
        id: freshId('fragile'),
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
        const [, send] = hooks.useActor(machine);

        return (
          <button type="button" onClick={() => send({ type: 'BREAK' })}>
            Break
          </button>
        );
      }

      render(
        <Boundary>
          <Fragile />
        </Boundary>,
      );
      await flush();

      const errors = await uncaught(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Break' }));
      });

      expect({ alerts: alerts(), uncaught: errors }).toEqual({ alerts: ['Broken on purpose'], uncaught: [] });
    });

    test('an error raised while the actor starts goes to the nearest error boundary, and is not reported as unhandled', async () => {
      const machine = createMachine({
        id: freshId('broken'),
        entry: () => {
          throw new Error('Broken on start');
        },
      });

      function Broken() {
        hooks.useActor(machine);

        return <p>rendered</p>;
      }

      const errors = await uncaught(() =>
        render(
          <Boundary>
            <Broken />
          </Boundary>,
        ),
      );

      expect({ alerts: alerts(), uncaught: errors }).toEqual({ alerts: ['Broken on start'], uncaught: [] });
    });
  });
});

describe('useActorRef', () => {
  test('components that read it through useSelector show a preview in place, and the real state on release', async () => {
    const machine = createToggleMachine();
    const values = commitsOf<string>();
    const flips = commitsOf<number>();

    function Value({ actorRef }: { actorRef: AnyActorRef }) {
      const value = useSelector(actorRef, (snapshot: AnyMachineSnapshot) => snapshot.value);
      useCommits(values, String(value));

      return <output aria-label="toggle">{JSON.stringify(value)}</output>;
    }

    function Flips({ actorRef }: { actorRef: ActorRefFrom<ToggleMachine> }) {
      // A new object for each selection, which shallowEqual keeps from counting as a change.
      const selected = useSelector(actorRef, (snapshot) => ({ flips: snapshot.context.flips }), shallowEqual);

      useCommits(flips, selected.flips);

      return null;
    }

    function Lamp() {
      const actorRef = useActorRef(machine);

      return (
        <>
          <Value actorRef={actorRef} />
          <Flips actorRef={actorRef} />
        </>
      );
    }

    render(
      <>
        <Lamp />
        <Konat defaultOpen />
      </>,
    );
    await flush();

    await preview(machine.id, ['on']);
    const previewed = shown();
    await release(machine.id);
    expect({ previewed, released: shown(), values, flips }).toEqual({
      previewed: 'on',
      released: 'off',
      values: { mounts: 1, renders: ['off', 'on', 'off'] },
      // The preview has the live context, so the selected count stays the same.
      flips: { mounts: 1, renders: [0] },
    });
  });

  test('a send through it during a preview is blocked, and reaches the actor after the release', async () => {
    const machine = createToggleMachine();

    function Lamp() {
      const actorRef = useActorRef(machine);
      const value = useSelector(actorRef, (snapshot) => snapshot.value);

      return (
        <>
          <output aria-label="toggle">{JSON.stringify(value)}</output>
          <button type="button" onClick={() => actorRef.send({ type: 'TOGGLE' })}>
            Toggle
          </button>
        </>
      );
    }

    render(
      <>
        <Lamp />
        <Konat defaultOpen />
      </>,
    );
    await flush();
    await show(machine.id);
    await clearBlockedEvents();

    await preview(machine.id, ['on']);
    await press('Toggle');
    const blocked = { shown: shown(), rows: blockedEvents() };
    await release(machine.id);
    const released = shown();
    await press('Toggle');
    expect({ blocked, released, delivered: shown(), rows: blockedEvents() }).toEqual({
      blocked: { shown: 'on', rows: [`TOGGLE · ${machine.id} · 1 · in on`] },
      released: 'off',
      delivered: 'on',
      rows: [`TOGGLE · ${machine.id} · 1 · in on`],
    });
  });

  test('its observer gets the preview and the release, but not the real updates in between', async () => {
    const machine = createLoaderMachine();
    let current: AnyActorRef | undefined;
    const delivered: { value: unknown; current: boolean }[] = [];

    // The observer reads the actor too, as an app's observer may.
    const listener = (snapshot: AnyMachineSnapshot) => {
      delivered.push({ value: snapshot.value, current: snapshot === current?.getSnapshot() });
    };

    function Loader() {
      const actorRef = useActorRef(machine, { systemId: LOADER }, listener);
      React.useLayoutEffect(() => {
        current = actorRef;
      });

      return (
        <button type="button" onClick={() => actorRef.system.get(LOADER)?.send({ type: 'LOADED' })}>
          Finish loading
        </button>
      );
    }

    render(
      <>
        <Loader />
        <Konat defaultOpen />
      </>,
    );
    await flush();
    delivered.length = 0;

    await preview(machine.id, ['failed']);
    const previewed = delivered.splice(0);
    await press('Finish loading');
    const moved = { delivered: delivered.splice(0), live: panel().live };
    await release(machine.id);
    expect({ previewed, moved, released: delivered }).toEqual({
      previewed: [{ value: 'failed', current: true }],
      moved: { delivered: [], live: ['loaded'] },
      released: [{ value: 'loaded', current: true }],
    });
  });

  describe.each(IMPLEMENTATIONS)('like @xstate/react, with %s', (_, hooks) => {
    test('its observer, a listener or an observer object, gets each snapshot as the actor starts and moves on', async () => {
      const machine = createToggleMachine();
      const listened: unknown[] = [];
      const observed: unknown[] = [];

      const listener = (snapshot: AnyMachineSnapshot) => {
        listened.push(snapshot.value);
      };

      const observer = {
        next: (snapshot: AnyMachineSnapshot) => {
          observed.push(snapshot.value);
        },
      };

      function Lamps() {
        const first = hooks.useActorRef(machine, undefined, listener);
        const second = hooks.useActorRef(machine, undefined, observer);

        return (
          <button
            type="button"
            onClick={() => {
              first.send({ type: 'TOGGLE' });
              second.send({ type: 'TOGGLE' });
            }}
          >
            Toggle
          </button>
        );
      }

      render(<Lamps />);
      await flush();

      await press('Toggle');
      await press('Toggle');
      // StrictMode starts the actor twice.
      expect({ listened, observed }).toEqual({
        listened: ['off', 'off', 'on', 'off'],
        observed: ['off', 'off', 'on', 'off'],
      });
    });

    test('runs fromPromise logic that useSelector reads', async () => {
      let resolve: (value: string) => void = () => {};

      const loaded = new Promise<string>((done) => {
        resolve = done;
      });

      const load = fromPromise(() => loaded);

      function Load() {
        const actorRef = hooks.useActorRef(load);
        const status = hooks.useSelector(actorRef, (snapshot) => snapshot.status);
        const output = hooks.useSelector(actorRef, (snapshot) => snapshot.output);

        return <output aria-label="load">{JSON.stringify({ status, output })}</output>;
      }

      render(<Load />);

      const before = shown('load');
      resolve('loaded');
      await flush();
      expect({ before, after: shown('load') }).toEqual({
        before: { status: 'active' },
        after: { status: 'done', output: 'loaded' },
      });
    });
  });
});

describe('createActorContext', () => {
  test('the Provider, its useSelector and its useActorRef show a preview in place, block sends, and release it', async () => {
    const machine = createToggleMachine();
    const ToggleContext = createActorContext(machine);
    const values = commitsOf<string>();
    const lit = commitsOf<boolean>();
    const others = commitsOf<null>();

    function Value() {
      const value = ToggleContext.useSelector((snapshot) => snapshot.value);
      useCommits(values, String(value));

      return <output aria-label="toggle">{JSON.stringify(value)}</output>;
    }

    function Lit() {
      const actorRef = ToggleContext.useActorRef();
      const isLit = useSelector(actorRef, (snapshot) => snapshot.hasTag('lit'));
      useCommits(lit, isLit);

      return (
        <button type="button" onClick={() => actorRef.send({ type: 'TOGGLE' })}>
          Toggle
        </button>
      );
    }

    function Other() {
      useCommits(others, null);

      return null;
    }

    render(
      <>
        <ToggleContext.Provider>
          <Value />
          <Lit />
          <Other />
        </ToggleContext.Provider>
        <Konat defaultOpen />
      </>,
    );
    await flush();
    await show(machine.id);
    await clearBlockedEvents();

    await preview(machine.id, ['on']);
    await press('Toggle');
    const blocked = { shown: shown(), rows: blockedEvents() };
    await release(machine.id);
    expect({ blocked, released: shown(), values, lit, others }).toEqual({
      blocked: { shown: 'on', rows: [`TOGGLE · ${machine.id} · 1 · in on`] },
      released: 'off',
      values: { mounts: 1, renders: ['off', 'on', 'off'] },
      lit: { mounts: 1, renders: [false, true, false] },
      // The Provider doesn't render again when the state changes, so neither do children that don't read the actor.
      others: { mounts: 1, renders: [null] },
    });
  });

  test('a consumer that mounts during a preview shows it from its first render', async () => {
    const machine = createToggleMachine();
    const ToggleContext = createActorContext(machine);

    function Late() {
      const value = ToggleContext.useSelector((snapshot) => snapshot.value);
      const [first] = React.useState(value);

      return <output aria-label="late">{JSON.stringify({ first, now: value })}</output>;
    }

    const app = (children: React.ReactNode) => (
      <>
        <ToggleContext.Provider>{children}</ToggleContext.Provider>
        <Konat defaultOpen />
      </>
    );

    const view = render(app(null));
    await flush();

    await preview(machine.id, ['on']);
    view.rerender(app(<Late />));
    await flush();
    expect(shown('late')).toEqual({ first: 'on', now: 'on' });
  });

  test('Provider options replace the context options one by one, and debug as a whole, which never reaches XState', async () => {
    type Greeting = { name: string };

    // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
    const machine = setup({
      types: { input: {} as Greeting, context: {} as Greeting },
    }).createMachine({
      id: freshId('greeting'),
      context: ({ input }) => ({ name: input.name }),
      initial: 'hello',
      states: { hello: {} },
    });

    const base = freshId('greeting-base');
    const provided = freshId('greeting-provided');
    const GreetingContext = createActorContext(machine, { input: { name: 'Ada' }, debug: { id: base, label: 'Base' } });

    function Name() {
      const { options } = GreetingContext.useActorRef();
      const name = GreetingContext.useSelector((snapshot) => snapshot.context.name);

      return <output aria-label="greeting">{JSON.stringify({ name, input: options.input, debug: 'debug' in options })}</output>;
    }

    render(
      <>
        <GreetingContext.Provider options={{ input: { name: 'Grace' }, debug: { id: provided } }}>
          <Name />
        </GreetingContext.Provider>
        <Konat defaultOpen />
      </>,
    );
    await flush();

    const rows = await machines();
    await show(provided);
    expect({ shown: shown('greeting'), machines: rows, instances: instances() }).toEqual({
      shown: { name: 'Grace', input: { name: 'Grace' }, debug: false },
      machines: [provided],
      instances: [`${provided} · 1`],
    });
  });

  test('the Provider logic prop replaces the context logic', async () => {
    // The logic prop takes a machine of another type, so the context takes any machine.
    const ToggleContext = createActorContext<AnyStateMachine>(createToggleMachine());

    const other = createMachine({
      id: freshId('other-toggle'),
      initial: 'on',
      context: { flips: 0 },
      states: { off: {}, on: {} },
    });

    function Value() {
      return <output aria-label="toggle">{JSON.stringify(ToggleContext.useSelector((snapshot) => snapshot.value))}</output>;
    }

    render(
      <>
        <ToggleContext.Provider logic={other}>
          <Value />
        </ToggleContext.Provider>
        <Konat defaultOpen />
      </>,
    );
    await flush();

    const before = { shown: shown(), machines: await machines() };
    await preview(other.id, ['off']);
    expect({ before, previewed: shown() }).toEqual({ before: { shown: 'on', machines: [other.id] }, previewed: 'off' });
  });

  describe.each(IMPLEMENTATIONS)('like @xstate/react, with %s', (_, hooks, previews) => {
    test('throws for the deprecated machine prop', () => {
      const machine = createToggleMachine();

      const { Provider } = hooks.createActorContext(machine);

      render(
        <Boundary>
          {/* @ts-expect-error The machine prop is deprecated, so its type is never. */}
          <Provider machine={machine} />
        </Boundary>,
      );
      expect(alerts()).toEqual(['The "machine" prop has been deprecated. Please use "logic" instead.']);
    });

    test('throws when its hooks are used outside the Provider', () => {
      const ToggleContext = hooks.createActorContext(createToggleMachine());

      function Orphan() {
        ToggleContext.useSelector((snapshot) => snapshot.value);

        return null;
      }

      render(
        <Boundary>
          <Orphan />
        </Boundary>,
      );
      expect(alerts()).toEqual(['You used a hook from "ActorProvider" but it\'s not inside a <ActorProvider> component.']);
    });

    test('a memoized consumer renders once, though the Provider changes debug.label, and its actor previews', async () => {
      const machine = createToggleMachine();
      const ToggleContext = hooks.createActorContext(machine);
      const commits = commitsOf<unknown>();

      const Consumer = React.memo(function Consumer() {
        useCommits(commits, ToggleContext.useActorRef());

        return null;
      });

      // SAFETY: The types of @xstate/react have no debug option. Its Provider gives debug to XState, which ignores it.
      const app = (label: string) => (
        <>
          <ToggleContext.Provider options={{ debug: { label } } as never}>
            <Consumer />
          </ToggleContext.Provider>
          <Konat defaultOpen />
        </>
      );

      const view = render(app('Before'));
      await flush();

      view.rerender(app('After'));
      await flush();

      if (previews) {
        await preview(machine.id, ['on']);
        await release(machine.id);
      }

      expect({ mounts: commits.mounts, renders: commits.renders.length }).toEqual({ mounts: 1, renders: 1 });
    });
  });
});

describe('logic other than a machine', () => {
  test('runs unregistered, so the overlay lists only the machines', async () => {
    const machine = createToggleMachine();
    const counter = fromTransition((count: number) => count + 1, 0);
    const load = fromPromise(async () => 'loaded');

    function App() {
      useActor(counter);
      useActorRef(load);
      useMachine(machine);

      return null;
    }

    render(
      <>
        <App />
        <Konat defaultOpen />
      </>,
    );
    await flush();

    expect(await machines()).toEqual([machine.id]);
  });
});
