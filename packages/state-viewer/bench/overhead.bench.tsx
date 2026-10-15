// What state-viewer adds in development while the panel is closed.
// Each case runs the same work with @xstate/react and with state-viewer/xstate.
// The state-viewer rows run without <StateViewer />, and with it mounted and its panel closed.
// The benchmarks run in jsdom under StrictMode, as the tests do, so compare the rows of a case, not absolute times.
//
// Run with: pnpm --filter state-viewer bench

import { act, cleanup, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import { test } from 'vitest';
import { assign, createActor, setup, type Actor } from 'xstate';
import { StateViewer } from '../src';
import { REGISTRY_KEY } from '../src/core/registry';
import * as stateViewer from '../src/xstate';

const counterMachine = setup({
  types: { context: {} as { count: number }, events: {} as { type: 'INC' } },
}).createMachine({
  id: 'counter',
  initial: 'even',
  context: { count: 0 },
  states: {
    even: { on: { INC: { target: 'odd', actions: assign({ count: ({ context }) => context.count + 1 }) } } },
    odd: { on: { INC: { target: 'even', actions: assign({ count: ({ context }) => context.count + 1 }) } } },
  },
});

type Hooks = Pick<typeof xstateReact, 'useMachine'>;

const IMPLEMENTATIONS: [name: string, hooks: Hooks, overlay: boolean][] = [
  ['@xstate/react', xstateReact, false],
  ['state-viewer/xstate, no <StateViewer />', stateViewer as unknown as Hooks, false],
  ['state-viewer/xstate, panel closed', stateViewer as unknown as Hooks, true],
];

function reset(): void {
  cleanup();
  delete (globalThis as Record<string, unknown>)[REGISTRY_KEY];
  sessionStorage.clear();
  localStorage.clear();
}

function mountOverlay(overlay: boolean): void {
  if (overlay) render(<StateViewer defaultOpen={false} />);
}

test('a transition that re-renders a useMachine component', async ({ bench }) => {
  const runs = IMPLEMENTATIONS.map(([name, hooks, overlay]) => {
    let send: (event: { type: 'INC' }) => void = () => {};
    function Counter() {
      const [snapshot, sendEvent] = hooks.useMachine(counterMachine);
      send = sendEvent;
      return <output>{snapshot.context.count}</output>;
    }
    const mount = () => {
      reset();
      mountOverlay(overlay);
      render(<Counter />);
    };
    return bench(name, { beforeAll: mount, afterAll: reset }, async () => {
      await act(async () => send({ type: 'INC' }));
    });
  });
  await bench.compare(...runs);
});

test('mounting and unmounting 50 rows, each with useMachine', async ({ bench }) => {
  const runs = IMPLEMENTATIONS.map(([name, hooks, overlay]) => {
    function Row() {
      const [snapshot] = hooks.useMachine(counterMachine);
      return <li>{String(snapshot.value)}</li>;
    }
    function List() {
      return (
        <ul>
          {Array.from({ length: 50 }, (_, index) => (
            <Row key={index} />
          ))}
        </ul>
      );
    }
    const mount = () => {
      reset();
      mountOverlay(overlay);
    };
    return bench(name, { beforeAll: mount, afterAll: reset }, async () => {
      let unmount: () => void = () => {};
      await act(async () => {
        unmount = render(<List />).unmount;
      });
      await act(async () => unmount());
    });
  });
  await bench.compare(...runs);
});

test('100 events to an actor outside React', async ({ bench }) => {
  let plainActor: Actor<typeof counterMachine> | undefined;
  const plain = bench(
    'plain actor',
    {
      beforeAll: () => {
        reset();
        plainActor = createActor(counterMachine).start();
      },
      afterAll: () => {
        plainActor?.stop();
      },
    },
    () => {
      for (let i = 0; i < 100; i++) plainActor!.send({ type: 'INC' });
    },
  );

  const connected = [
    ['connect(), no <StateViewer />', false],
    ['connect(), panel closed', true],
  ] as const;
  const runs = connected.map(([name, overlay]) => {
    let actor: Actor<typeof counterMachine> | undefined;
    return bench(
      name,
      {
        beforeAll: () => {
          reset();
          mountOverlay(overlay);
          actor = stateViewer.connect(createActor(counterMachine).start(), { id: 'counter' });
        },
        afterAll: () => {
          actor?.stop();
          reset();
        },
      },
      () => {
        for (let i = 0; i < 100; i++) actor!.send({ type: 'INC' });
      },
    );
  });

  await bench.compare(plain, ...runs);
});
