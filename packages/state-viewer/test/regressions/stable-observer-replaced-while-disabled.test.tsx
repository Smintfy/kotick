// A component builds its upload machine from an endpoint prop and gives useActorRef a stable observer (useCallback)
// that reacts to the upload's state (a "done" toast, analytics), and a dev toggle can take the machine out of the
// debugger (`debug.disabled`). Nothing is ever previewed, so the observer hears exactly what it hears with
// @xstate/react.
//
// When the endpoint changes, @xstate/react replaces the actor and leaves the stable observer subscribed to the old one,
// which it then stops (spec §10.2, "Observers and the actor's ending"). Between the layout phase of that commit and its
// passive effects the old upload still runs, and its socket reports there (here from a layout effect): the observer
// hears it straight from XState. The hook moves what the observer was told to the new actor in that commit's layout
// phase, debug.disabled or not, and what XState tells the observer about the old actor leaves it owed nothing about
// that actor, so turning debug back on, or an Activity hiding and revealing the component, doesn't repeat it: a "done"
// handler runs once.

import { render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import * as React from 'react';
import { useCallback } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fromCallback, setup, type SnapshotFrom } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { flush, resetRegistry } from '../xstate/helpers';

type SocketEvent = { type: 'PAUSE' | 'FINISH' };
/** What each running upload's invoked socket reports through, by endpoint. */
const sockets = new Map<string, (event: SocketEvent) => void>();

function createUploadMachine(endpoint: string) {
  return setup({
    actors: {
      socket: fromCallback<SocketEvent, { endpoint: string }>(({ sendBack, input }) => {
        sockets.set(input.endpoint, sendBack);
        return () => {
          if (sockets.get(input.endpoint) === sendBack) sockets.delete(input.endpoint);
        };
      }),
    },
  }).createMachine({
    id: 'upload',
    initial: 'uploading',
    context: { endpoint },
    invoke: { src: 'socket', input: ({ context }) => ({ endpoint: context.endpoint }) },
    states: {
      uploading: { on: { PAUSE: 'paused', FINISH: 'uploaded' } },
      paused: {},
      uploaded: { type: 'final' },
    },
  });
}

type UploadSnapshot = SnapshotFrom<ReturnType<typeof createUploadMachine>>;
type Hooks = Pick<typeof xstateReact, 'useActorRef'>;
type Mode = 'visible' | 'hidden';

const Activity = (
  React as unknown as { Activity: React.ComponentType<{ mode: Mode; children: React.ReactNode }> }
).Activity;

/** The actor a snapshot is of, by the endpoint its machine was built for. */
const actorOf = (snapshot: UploadSnapshot): string =>
  (snapshot.machine.config.context as { endpoint: string }).endpoint === '/upload' ? 'old' : 'new';
const label = (snapshot: UploadSnapshot): string => `${snapshot.status}:${String(snapshot.value)} (${actorOf(snapshot)})`;

beforeEach(() => {
  resetRegistry();
  sockets.clear();
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

type Props = { endpoint: string; disabled: boolean; mode: Mode };

function mountUpload(hooks: Hooks, calls: string[], initialDisabled = false) {
  // What the old upload's socket reports once the new upload is in place, in the commit that replaces it.
  let report: SocketEvent['type'] | undefined;
  function Upload({ endpoint, disabled }: Omit<Props, 'mode'>) {
    const machine = React.useMemo(() => createUploadMachine(endpoint), [endpoint]);
    const observer = useCallback((snapshot: UploadSnapshot) => {
      calls.push(label(snapshot));
    }, []);
    hooks.useActorRef(machine, { debug: { disabled } } as never, observer);
    const previous = React.useRef(endpoint);
    React.useLayoutEffect(() => {
      if (previous.current !== endpoint && report) sockets.get(previous.current)?.({ type: report });
      previous.current = endpoint;
    });
    return null;
  }
  function App({ mode, ...props }: Props) {
    return (
      <Activity mode={mode}>
        <Upload {...props} />
      </Activity>
    );
  }
  const props: Props = { endpoint: '/upload', disabled: initialDisabled, mode: 'visible' };
  const view = render(<App {...props} />);
  const update = async (patch: Partial<Props>): Promise<void> => {
    Object.assign(props, patch);
    view.rerender(<App {...props} />);
    await flush();
  };
  return {
    update,
    /** The parent passes a new endpoint, and the old upload's socket reports `event` in that commit. */
    replace: async (event: SocketEvent['type'] | undefined): Promise<void> => {
      report = event;
      await update({ endpoint: '/v2/upload' });
      report = undefined;
    },
  };
}

describe.each([
  ['@xstate/react (control)', xstateReact as Hooks],
  ['state-viewer/xstate', stateViewer as unknown as Hooks],
] as const)('%s', (_name, hooks) => {
  test('a stable observer hears the old upload’s done snapshot once when debug is turned back on', async () => {
    const calls: string[] = [];
    const upload = mountUpload(hooks, calls);
    await flush();
    // The dev toggle takes the machine out of the debugger.
    await upload.update({ disabled: true });
    calls.length = 0;

    calls.push('[new endpoint]');
    await upload.replace('FINISH');
    calls.push('[debug on]');
    await upload.update({ disabled: false });

    expect(calls).toEqual(['[new endpoint]', 'done:uploaded (old)', '[debug on]']);
  });

  test('a stable observer hears the old upload’s update once when an Activity hides and reveals it', async () => {
    const calls: string[] = [];
    const upload = mountUpload(hooks, calls);
    await flush();
    await upload.update({ disabled: true });
    calls.length = 0;

    calls.push('[new endpoint]');
    await upload.replace('PAUSE');
    calls.push('[hide]');
    await upload.update({ mode: 'hidden' });
    calls.push('[reveal]');
    await upload.update({ mode: 'visible' });

    // On the reveal @xstate/react subscribes the observer to the new actor and starts it, twice under StrictMode.
    expect(calls).toEqual([
      '[new endpoint]',
      'active:paused (old)',
      '[hide]',
      '[reveal]',
      'active:uploading (new)',
      'active:uploading (new)',
    ]);
  });

  test('debug on throughout: the old upload’s done snapshot once, whatever debug.disabled does afterwards', async () => {
    const calls: string[] = [];
    const upload = mountUpload(hooks, calls);
    await flush();
    calls.length = 0;
    calls.push('[new endpoint]');
    await upload.replace('FINISH');
    calls.push('[disable]');
    await upload.update({ disabled: true });
    calls.push('[debug on]');
    await upload.update({ disabled: false });
    expect(calls).toEqual(['[new endpoint]', 'done:uploaded (old)', '[disable]', '[debug on]']);
  });

  test('debug.disabled after it was on, the old upload silent in the window: nothing when debug is turned back on', async () => {
    const calls: string[] = [];
    const upload = mountUpload(hooks, calls);
    await flush();
    await upload.update({ disabled: true });
    calls.length = 0;
    calls.push('[new endpoint]');
    await upload.replace(undefined);
    calls.push('[debug on]');
    await upload.update({ disabled: false });
    expect(calls).toEqual(['[new endpoint]', '[debug on]']);
  });

  test('debug.disabled from the mount: the old upload’s done snapshot once', async () => {
    const calls: string[] = [];
    const upload = mountUpload(hooks, calls, true);
    await flush();
    calls.length = 0;
    calls.push('[new endpoint]');
    await upload.replace('FINISH');
    calls.push('[debug on]');
    await upload.update({ disabled: false });
    expect(calls).toEqual(['[new endpoint]', 'done:uploaded (old)', '[debug on]']);
  });

  test('debug.disabled after it was on: the old upload’s update once when debug is turned back on', async () => {
    const calls: string[] = [];
    const upload = mountUpload(hooks, calls);
    await flush();
    await upload.update({ disabled: true });
    calls.length = 0;
    calls.push('[new endpoint]');
    await upload.replace('PAUSE');
    calls.push('[debug on]');
    await upload.update({ disabled: false });
    expect(calls).toEqual(['[new endpoint]', 'active:paused (old)', '[debug on]']);
  });
});
