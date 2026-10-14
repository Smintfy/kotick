// The observer given to useActorRef hears how the real actor ended once no preview hides the real snapshot (spec §10.2,
// "Observers and the actor's ending"; R13), and when @xstate/react replaces the actor (a new config: Fast Refresh, a
// machine built from props), an ending a preview held back for the old actor is owed and heard "once the hook's actor
// is no longer previewed ..., before anything about the new actor".
//
// Here the upload fails while a preview of `failed` shows (the socket reports an error the machine doesn't handle), and
// then a machine built from a new endpoint prop replaces the actor. The new actor is created from the old one's
// persisted error snapshot, and XState calls its observers' error callback when @xstate/react starts it. The observer
// has an error callback, so with @xstate/react it hears the error twice: at the failure, and at the restart. With
// state-viewer the new actor stays previewed (same machine id, so the preview carries over), so both errors wait for
// the release, the old actor's first: a not-yet-started actor restored from an error snapshot isn't one that "failed
// without an error callback", and XState's start tells the observer.

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fromCallback, setup, type Observer, type SnapshotFrom } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

let failUpload: (() => void) | undefined;

function createUploadMachine(endpoint: string) {
  return setup({
    actors: {
      socket: fromCallback(({ sendBack }) => {
        failUpload = () => sendBack({ type: 'SOCKET_ERROR' });
        return () => {
          failUpload = undefined;
        };
      }),
    },
    actions: {
      crash: () => {
        throw new Error('socket closed');
      },
    },
  }).createMachine({
    id: 'upload',
    initial: 'uploading',
    context: { endpoint },
    states: {
      uploading: { invoke: { src: 'socket' }, on: { SOCKET_ERROR: { actions: 'crash' } } },
      failed: {},
      uploaded: { type: 'final' },
    },
  });
}

type UploadMachine = ReturnType<typeof createUploadMachine>;
type UploadSnapshot = SnapshotFrom<UploadMachine>;
type Hooks = Pick<typeof xstateReact, 'useActorRef'>;

const IMPLEMENTATIONS: [name: string, hooks: Hooks, previews: boolean][] = [
  ['@xstate/react (control)', xstateReact, false],
  ['state-viewer/xstate', stateViewer as unknown as Hooks, true],
];

beforeEach(() => {
  resetRegistry();
  failUpload = undefined;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

describe.each(IMPLEMENTATIONS)('%s', (_name, hooks, previews) => {
  test('an observer with an error callback hears no error while the replacement actor is previewed', async () => {
    const calls: string[] = [];
    // Whether a preview showed when the observer was called.
    const previewing = (): string => (previews && Object.keys(registry().getSnapshot().overrides).length ? ' (during preview)' : '');
    function Upload({ endpoint }: { endpoint: string }) {
      const machine = React.useMemo(() => createUploadMachine(endpoint), [endpoint]);
      const observer: Observer<UploadSnapshot> = {
        next: (snapshot) => calls.push(`next:${String(snapshot.value)}`),
        error: (error) => calls.push(`error:${(error as Error).message}${previewing()}`),
      };
      hooks.useActorRef(machine, undefined, observer);
      return null;
    }
    const view = render(<Upload endpoint="/upload" />);
    await flush();

    if (previews) act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves: ['failed'] }));
    await flush();
    calls.length = 0;

    calls.push('[fail]');
    act(() => failUpload!());
    await flush();

    calls.push('[replace]');
    view.rerender(<Upload endpoint="/v2/upload" />);
    await flush();
    // Same machine id: the preview carries over to the new actor.
    if (previews) expect(Object.keys(registry().getSnapshot().overrides)).toHaveLength(1);

    calls.push('[release]');
    if (previews) act(() => registry().release());
    await flush();

    expect(calls).toEqual(
      previews
        ? ['[fail]', '[replace]', '[release]', 'error:socket closed', 'error:socket closed']
        : ['[fail]', 'error:socket closed', '[replace]', 'error:socket closed', '[release]'],
    );
  });
});
