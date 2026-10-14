// Verifies "proxy-identity-changes-with-label": the hooks must hand out one actor ref (and one send) for the life of
// the actor, as @xstate/react does in production and as spec §10.2 says ("the proxy is memoized per real actor"),
// even when debug.label or debug.id changes between renders. Each component runs against both packages, so the
// @xstate/react rows show the behavior the adapter has to match.

import { render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import * as React from 'react';
import { beforeEach, describe, expect, test } from 'vitest';
import { assign, setup } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { flush, onlyHandle, resetRegistry } from '../xstate/helpers';

const loaderMachine = setup({
  types: { context: {} as { loads: number }, events: {} as { type: 'LOAD' } },
}).createMachine({
  id: 'loader',
  initial: 'idle',
  context: { loads: 0 },
  states: {
    idle: { on: { LOAD: { actions: assign({ loads: ({ context }) => context.loads + 1 }) } } },
  },
});

type Hooks = Pick<typeof xstateReact, 'useMachine' | 'createActorContext'>;

const IMPLEMENTATIONS: [name: string, hooks: Hooks][] = [
  ['@xstate/react', xstateReact],
  ['state-viewer/xstate', stateViewer as unknown as Hooks],
];

/** `debug` is stripped before the options reach XState; @xstate/react ignores it as an unknown actor option. */
type DebugProps = { label?: string; id?: string };

beforeEach(() => {
  resetRegistry();
});

describe.each(IMPLEMENTATIONS)('%s', (name, hooks) => {
  test('useMachine keeps its actor ref and send when only debug.label changes', async () => {
    const actorRefs = new Set<unknown>();
    const sends = new Set<unknown>();
    let loads = 0;
    function Loader({ title }: { title: string }) {
      const [snapshot, send, actorRef] = hooks.useMachine(loaderMachine, { debug: { label: title } } as never);
      // Committed renders only: React 18's StrictMode throws away the first render, and the actor it made.
      React.useLayoutEffect(() => {
        actorRefs.add(actorRef);
        sends.add(send);
      });
      loads = snapshot.context.loads;
      // The common "load on mount" effect: it depends on send, so a new send sends LOAD again.
      React.useEffect(() => {
        send({ type: 'LOAD' });
      }, [send]);
      return null;
    }

    const { rerender } = render(<Loader title="Inbox" />);
    await flush();
    // StrictMode runs the effect twice on mount, in both packages.
    const loadsAfterMount = loads;
    if (name === 'state-viewer/xstate') expect(onlyHandle('loader').label).toBe('Inbox');

    rerender(<Loader title="Inbox (3 unread)" />);
    await flush();

    expect.soft(actorRefs.size).toBe(1);
    expect.soft(sends.size).toBe(1);
    expect.soft(loads).toBe(loadsAfterMount);
    if (name === 'state-viewer/xstate') expect.soft(onlyHandle('loader').label).toBe('Inbox (3 unread)');
  });

  test('useMachine keeps its actor ref when debug.id changes', async () => {
    const actorRefs = new Set<unknown>();
    function Loader({ id }: { id: string }) {
      const [, , actorRef] = hooks.useMachine(loaderMachine, { debug: { id } } as never);
      React.useLayoutEffect(() => {
        actorRefs.add(actorRef);
      });
      return null;
    }

    const { rerender } = render(<Loader id="loader-a" />);
    await flush();
    rerender(<Loader id="loader-b" />);
    await flush();

    expect.soft(actorRefs.size).toBe(1);
  });

  test('a memoized context consumer does not re-render when the Provider only changes debug.label', async () => {
    const LoaderContext = hooks.createActorContext(loaderMachine);
    const consumerRefs = new Set<unknown>();
    let consumerRenders = 0;
    const Consumer = React.memo(function Consumer() {
      consumerRefs.add(LoaderContext.useActorRef());
      consumerRenders += 1;
      return null;
    });
    function App({ debug }: { debug: DebugProps }) {
      return (
        <LoaderContext.Provider options={{ debug } as never}>
          <Consumer />
        </LoaderContext.Provider>
      );
    }

    const { rerender } = render(<App debug={{ label: 'Before' }} />);
    await flush();
    const rendersAfterMount = consumerRenders;

    rerender(<App debug={{ label: 'After' }} />);
    await flush();

    expect.soft(consumerRefs.size).toBe(1);
    expect.soft(consumerRenders).toBe(rendersAfterMount);
  });
});
