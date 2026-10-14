// When @xstate/react replaces a hook's actor (a new config: Fast Refresh, a machine built from props) after the old
// actor finished during a preview, the old actor's ending is owed: the observer given to useActorRef hears it "once the
// hook's actor is no longer previewed ..., before anything about the new actor" (spec §10.2, "Observers and the actor's
// ending"). An inline observer, which @xstate/react subscribes to the new actor, also hears the new actor's ending
// (XState repeats a finished actor's ending when it's started from a done snapshot), held back by the same preview.
//
// Turning `debug.disabled` on stops previewing the actor for the observer, as a release does, and delivers in the same
// order: the old actor's owed ending, then the new actor's.

import { act, render } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fromCallback, setup, type Observer, type SnapshotFrom } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

let finishUpload: (() => void) | undefined;

function createUploadMachine(endpoint: string) {
  return setup({
    actors: {
      socket: fromCallback(({ sendBack }) => {
        finishUpload = () => sendBack({ type: 'UPLOADED' });
        return () => {
          finishUpload = undefined;
        };
      }),
    },
  }).createMachine({
    id: 'upload',
    initial: 'uploading',
    context: { endpoint },
    states: {
      uploading: { invoke: { src: 'socket' }, on: { UPLOADED: 'uploaded' } },
      failed: {},
      uploaded: { type: 'final' },
    },
  });
}

type UploadMachine = ReturnType<typeof createUploadMachine>;
type UploadSnapshot = SnapshotFrom<UploadMachine>;

/** The actor a snapshot is of, by the endpoint its machine was built for: the replaced one (old) or the new one. */
const actorOf = (snapshot: UploadSnapshot): string =>
  (snapshot.machine.config.context as { endpoint: string }).endpoint === '/upload' ? 'old' : 'new';

beforeEach(() => {
  resetRegistry();
  finishUpload = undefined;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

test('debug.disabled after a replacement delivers the old actor’s owed ending before the new actor’s', async () => {
  const calls: string[] = [];
  function Upload({ endpoint, disabled }: { endpoint: string; disabled: boolean }) {
    const machine = React.useMemo(() => createUploadMachine(endpoint), [endpoint]);
    const observer: Observer<UploadSnapshot> = {
      next: (snapshot) => calls.push(`next:${snapshot.status}:${String(snapshot.value)} (${actorOf(snapshot)})`),
      complete: () => calls.push('complete'),
    };
    stateViewer.useActorRef(machine, { debug: { disabled } }, observer);
    return null;
  }
  const view = render(<Upload endpoint="/upload" disabled={false} />);
  await flush();
  act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves: ['failed'] }));
  await flush();

  calls.length = 0;
  calls.push('[finish]');
  act(() => finishUpload!());
  await flush();
  calls.push('[replace]');
  view.rerender(<Upload endpoint="/v2/upload" disabled={false} />);
  await flush();
  calls.push('[disable]');
  view.rerender(<Upload endpoint="/v2/upload" disabled />);
  await flush();

  expect(calls).toEqual([
    '[finish]',
    'next:active:failed (old)',
    '[replace]',
    'next:active:failed (new)',
    '[disable]',
    // The old actor's owed ending first, as on a release.
    'next:done:uploaded (old)',
    'complete',
    'next:done:uploaded (new)',
    'complete',
    // @xstate/react subscribes this render's inline observer to the finished actor, and XState completes it.
    'complete',
  ]);
});

test('control: a release delivers the old actor’s owed ending first', async () => {
  const calls: string[] = [];
  function Upload({ endpoint }: { endpoint: string }) {
    const machine = React.useMemo(() => createUploadMachine(endpoint), [endpoint]);
    const observer: Observer<UploadSnapshot> = {
      next: (snapshot) => calls.push(`next:${snapshot.status}:${String(snapshot.value)} (${actorOf(snapshot)})`),
      complete: () => calls.push('complete'),
    };
    stateViewer.useActorRef(machine, undefined, observer);
    return null;
  }
  const view = render(<Upload endpoint="/upload" />);
  await flush();
  act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves: ['failed'] }));
  await flush();

  calls.length = 0;
  calls.push('[finish]');
  act(() => finishUpload!());
  await flush();
  calls.push('[replace]');
  view.rerender(<Upload endpoint="/v2/upload" />);
  await flush();
  calls.push('[release]');
  act(() => registry().release());
  await flush();

  expect(calls).toEqual([
    '[finish]',
    'next:active:failed (old)',
    '[replace]',
    'next:active:failed (new)',
    '[release]',
    'next:done:uploaded (old)',
    'complete',
    'next:done:uploaded (new)',
    'complete',
  ]);
});
