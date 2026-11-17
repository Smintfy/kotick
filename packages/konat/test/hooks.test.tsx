import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { createActorContext, useActor, useActorRef, useMachine, useSelector } from 'konat/xstate';
import { describe, expect, test } from 'vitest';
import {
  assign,
  createMachine,
  fromPromise,
  fromTransition,
  setup,
  type AnyActorRef,
  type AnyMachineSnapshot,
  type AnyStateMachine,
} from 'xstate';
import { mount, page, press } from './support/app';
import { alerts, Boundary } from './support/boundary';
import { uncaught } from './support/console';
import { REACT_MAJOR } from './support/react';
import { flush, freshId, instances, machines, preview, release, show } from './support/panel';

type ToggleEvent = { type: 'TOGGLE' };

function createToggleMachine() {
  // SAFETY: XState reads the types of setup() only at compile time. It never reads this value.
  return setup({ types: { events: {} as ToggleEvent } }).createMachine({
    id: freshId('toggle'),
    initial: 'off',
    states: { off: { on: { TOGGLE: 'on' } }, on: { tags: ['lit'], on: { TOGGLE: 'off' } } },
  });
}

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

type Commits<T> = { mounts: number; renders: T[] };

function commitsOf<T>(): Commits<T> {
  return { mounts: 0, renders: [] };
}

/**
 * StrictMode runs the layout effects of a mount twice with the same closure.
 * The render object tells the runs apart.
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

describe('a preview', () => {
  test('useMachine shows a preview in place as a real snapshot, and the real state on release, without a remount', async () => {
    const machine = createToggleMachine();
    const commits = commitsOf<string>();

    function Lamp() {
      const [snapshot] = useMachine(machine);
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

    await mount(<Lamp />);

    await preview(machine.id, ['on']);
    const previewed = shown();
    await release(machine.id);
    expect({ previewed, released: shown(), commits }).toEqual({
      previewed: { value: 'on', lit: true, on: true, canToggle: true, status: 'active' },
      released: { value: 'off', lit: false, on: false, canToggle: true, status: 'active' },
      commits: { mounts: 1, renders: ['off', 'on', 'off'] },
    });
  });

  test('useActorRef and createActorContext give components that read through useSelector a preview in place, and the real state on release', async () => {
    const hooked = createToggleMachine();
    const provided = createToggleMachine();
    const ToggleContext = createActorContext(provided);

    function Hooked() {
      const value = useSelector(useActorRef(hooked), (snapshot) => snapshot.value);

      return <output aria-label="hooked">{JSON.stringify(value)}</output>;
    }

    function Provided() {
      const value = ToggleContext.useSelector((snapshot) => snapshot.value);
      const lit = useSelector(ToggleContext.useActorRef(), (snapshot) => snapshot.hasTag('lit'));

      return <output aria-label="provided">{JSON.stringify({ value, lit })}</output>;
    }

    await mount(
      <>
        <Hooked />
        <ToggleContext.Provider>
          <Provided />
        </ToggleContext.Provider>
      </>,
    );

    const seen = () => ({ hooked: shown('hooked'), provided: shown('provided') });
    await preview(hooked.id, ['on']);
    await preview(provided.id, ['on']);
    const previewed = seen();
    await release(hooked.id);
    await release(provided.id);
    expect({ previewed, released: seen() }).toEqual({
      previewed: { hooked: 'on', provided: { value: 'on', lit: true } },
      released: { hooked: 'off', provided: { value: 'off', lit: false } },
    });
  });

  test('the observer of useActorRef gets the preview and the release, but not the real updates in between', async () => {
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

    await mount(<Loader />);
    delivered.length = 0;

    await preview(machine.id, ['failed']);
    const previewed = delivered.splice(0);
    await press('Finish loading');
    const moved = delivered.splice(0);
    await release(machine.id);
    expect({ previewed, moved, released: delivered }).toEqual({
      previewed: [{ value: 'failed', current: true }],
      moved: [],
      released: [{ value: 'loaded', current: true }],
    });
  });
});

describe('what the hooks return', () => {
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
      const [snapshot, send, actorRef] = useMachine(machine, { debug });
      useCommits(commits, { send, actorRef, loads: snapshot.context.loads });
      React.useEffect(() => {
        send({ type: 'LOAD' });
      }, [send]);

      return <output aria-label="inbox">{JSON.stringify(snapshot.context)}</output>;
    }

    const view = await mount(<Inbox debug={{ label: 'Inbox' }} />);
    view.rerender(page(<Inbox debug={{ label: 'Inbox (3 unread)' }} />));
    await flush();
    await preview(machine.id, ['failed']);
    await release(machine.id);
    view.rerender(page(<Inbox debug={{ label: 'Inbox (3 unread)', id: freshId('mail') }} />));
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
      // On React 18, the loads during StrictMode's second run of the effects make the hook render once more.
      loads: [0, 2, ...(REACT_MAJOR < 19 ? [2] : []), 2, 2, 2, 2],
      sends: 1,
      actorRefs: 1,
    });
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

    await mount(
      <>
        <GreetingContext.Provider options={{ input: { name: 'Grace' }, debug: { id: provided } }}>
          <Name />
        </GreetingContext.Provider>
      </>,
    );

    const rows = await machines();
    await show(provided);
    expect({ shown: shown('greeting'), machines: rows, instances: instances() }).toEqual({
      shown: { name: 'Grace', input: { name: 'Grace' }, debug: false },
      machines: [provided],
      instances: [`${provided} · 1`],
    });
  });

  test('logic other than a machine runs as on @xstate/react, and the overlay lists only the machines', async () => {
    const machine = createToggleMachine();

    const counter = fromTransition((count: number, event: { type: 'INCREMENT' }) => {
      return event.type === 'INCREMENT' ? count + 1 : count;
    }, 0);

    let resolve: (value: string) => void = () => {};

    const loaded = new Promise<string>((done) => {
      resolve = done;
    });

    const load = fromPromise(() => loaded);

    function App() {
      const [count, send] = useActor(counter);
      const loader = useActorRef(load);
      const output = useSelector(loader, (snapshot) => snapshot.output);
      useMachine(machine);

      return (
        <>
          <output aria-label="logic">{JSON.stringify({ count: count.context, output })}</output>
          <button type="button" onClick={() => send({ type: 'INCREMENT' })}>
            Increment
          </button>
        </>
      );
    }

    await mount(<App />);

    const before = shown('logic');
    await press('Increment');
    resolve('loaded');
    await flush();
    expect({ before, after: shown('logic'), machines: await machines() }).toEqual({
      before: { count: 0 },
      after: { count: 1, output: 'loaded' },
      machines: [machine.id],
    });
  });
});

describe('errors', () => {
  test('useActor throws when given an actor ref in place of actor logic', () => {
    const machine = createToggleMachine();

    function Misused({ actorRef }: { actorRef: AnyActorRef }) {
      // @ts-expect-error useActor takes actor logic, and this test gives it an actor ref.
      useActor(actorRef);

      return null;
    }

    function FromHook() {
      const actorRef = useActorRef(machine);

      return (
        <Boundary>
          <Misused actorRef={actorRef} />
        </Boundary>
      );
    }

    render(<FromHook />);
    expect(alerts()).toEqual([
      "useActor() expects actor logic (e.g. a machine), but received an ActorRef. Use the useSelector(actorRef, ...) hook instead to read the ActorRef's snapshot.",
    ]);
  });

  test('an error of the actor, as it starts or later, goes to the nearest error boundary, and is not reported as unhandled', async () => {
    const broken = createMachine({
      id: freshId('broken'),
      entry: () => {
        throw new Error('Broken on start');
      },
    });

    const fragile = createMachine({
      id: freshId('fragile'),
      on: {
        BREAK: {
          actions: () => {
            throw new Error('Broken on purpose');
          },
        },
      },
    });

    function Run({ machine }: { machine: AnyStateMachine }) {
      const [, send] = useActor(machine);

      return (
        <button type="button" onClick={() => send({ type: 'BREAK' })}>
          Break
        </button>
      );
    }

    const errors = await uncaught(() =>
      render(
        <>
          <Boundary>
            <Run machine={broken} />
          </Boundary>
          <Boundary>
            <Run machine={fragile} />
          </Boundary>
        </>,
      ),
    );

    errors.push(
      ...(await uncaught(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Break' }));
      })),
    );

    expect({ alerts: alerts(), uncaught: errors }).toEqual({
      alerts: ['Broken on start', 'Broken on purpose'],
      uncaught: [],
    });
  });
  test('the hooks of createActorContext throw outside the Provider', () => {
    const ToggleContext = createActorContext(createToggleMachine());

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
});
