// When `debug.disabled` turns on, the observer given to useActorRef leaves the preview as on a release.
// With nothing previewed there is nothing to leave: a release of an instance without a preview tells no one
// anything, and @xstate/react, which has no notion of debug options, sends the observer nothing either. Here the
// component only passes its observer while a panel is open (a common way to listen conditionally), so @xstate/react
// subscribes it to an actor that already moved, and it hears nothing until the next transition, debug.disabled or not:
// an `onChange` prop or an analytics hook doesn't fire for a state change that didn't happen.

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createMachine, type AnyActorRef, type SnapshotFrom } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { flush, handlesOf, resetRegistry } from '../xstate/helpers';

const toggleMachine = createMachine({
  id: 'toggle',
  initial: 'off',
  states: { off: { on: { TOGGLE: 'on' } }, on: { on: { TOGGLE: 'off' } } },
});

type Hooks = Pick<typeof xstateReact, 'useActorRef'>;

const IMPLEMENTATIONS: [name: string, hooks: Hooks][] = [
  ['@xstate/react (control)', xstateReact],
  ['state-viewer/xstate', stateViewer as unknown as Hooks],
];

beforeEach(() => {
  resetRegistry();
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

describe.each(IMPLEMENTATIONS)('%s', (_name, hooks) => {
  test('turning debug.disabled on, with nothing previewed, sends the observer nothing', async () => {
    const heard: string[] = [];
    let actorRef: AnyActorRef | undefined;
    const onChange = (snapshot: SnapshotFrom<typeof toggleMachine>): void => {
      heard.push(String(snapshot.value));
    };
    function Toggle({ panelOpen, debugDisabled }: { panelOpen: boolean; debugDisabled: boolean }) {
      actorRef = hooks.useActorRef(
        toggleMachine,
        { debug: { disabled: debugDisabled } } as never,
        panelOpen ? onChange : undefined,
      ) as AnyActorRef;
      return null;
    }

    const view = render(<Toggle panelOpen={false} debugDisabled={false} />);
    await flush();
    // The user flips the toggle, then opens the panel that listens to it.
    act(() => actorRef!.send({ type: 'TOGGLE' }));
    view.rerender(<Toggle panelOpen debugDisabled={false} />);
    await flush();
    expect(heard).toEqual([]);
    // No preview was ever made.
    if (hooks !== xstateReact) expect(handlesOf('toggle')).toHaveLength(1);

    // The developer keeps this actor out of the debugger.
    view.rerender(<Toggle panelOpen debugDisabled />);
    await flush();

    expect(heard).toEqual([]);
  });
});
