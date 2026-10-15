// The observer given to useActorRef hears how the real actor ended, as with @xstate/react, even when it finished
// while a preview hid it: once the preview is released, the observer gets the done snapshot, then complete if
// it has one, and nothing after that, not even later previews of the finished actor, which hooks keep registered.
// Apps react to the done snapshot in this observer (navigate, close a dialog, report a result).

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { assign, fromCallback, setup, type SnapshotFrom } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

/** What the invoked callback actor uses to tell its parent the upload finished, as a socket or timer would. */
let finishUpload: (() => void) | undefined;

const uploadMachine = setup({
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
  context: { url: '' },
  states: {
    uploading: {
      invoke: { src: 'socket' },
      on: { UPLOADED: { target: 'uploaded', actions: assign({ url: 'https://cdn/x.png' }) } },
    },
    failed: {},
    uploaded: { type: 'final' },
  },
});

type UploadSnapshot = SnapshotFrom<typeof uploadMachine>;
type Hooks = Pick<typeof xstateReact, 'useActorRef'>;

const IMPLEMENTATIONS: [name: string, hooks: Hooks, previews: boolean][] = [
  ['@xstate/react (control)', xstateReact, false],
  ['state-viewer/xstate', stateViewer as unknown as Hooks, true],
];

beforeEach(() => {
  resetRegistry();
  finishUpload = undefined;
  // Previews of states without a recording or fixture warn about falling back to live context.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

describe.each(IMPLEMENTATIONS)('%s', (_name, hooks, previews) => {
  /** Previews `leaves` on the upload, as someone in the overlay would; only the adapter registers it. */
  function preview(leaves: string[]): void {
    if (previews) act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves }));
  }

  /**
   * Mounts useActorRef with `observer`, finishes the upload underneath a preview of `failed`, and releases the
   * preview, as someone closing the overlay would.
   */
  async function finishDuringPreview(observer: Parameters<Hooks['useActorRef']>[2]): Promise<void> {
    function Upload() {
      hooks.useActorRef(uploadMachine, undefined, observer);
      return null;
    }
    render(<Upload />);
    await flush();

    preview(['failed']);
    // The real actor keeps running underneath and finishes.
    act(() => finishUpload?.());
    if (previews) {
      const handle = onlyHandle('upload');
      expect(handle.getActiveLeaves()).toEqual(['uploaded']);
      expect(registry().getOverride(keyOf(handle))?.leaves).toEqual(['failed']);
    }
    act(() => registry().release());
    await flush();
  }

  /** Previews the finished upload again and releases it. */
  async function previewAgain(): Promise<void> {
    preview(['failed']);
    await flush();
    preview(['uploading']);
    await flush();
    act(() => registry().release());
    await flush();
  }

  test('a listener function gets the done snapshot last, and nothing on later previews', async () => {
    const statuses: string[] = [];
    await finishDuringPreview((snapshot: UploadSnapshot) => statuses.push(snapshot.status));

    expect(statuses.filter((status) => status === 'done')).toEqual(['done']);
    expect(statuses.at(-1)).toBe('done');

    const ended = [...statuses];
    await previewAgain();
    expect(statuses).toEqual(ended);
  });

  test('an observer object gets the done snapshot, then complete, then nothing on later previews', async () => {
    const calls: string[] = [];
    await finishDuringPreview({
      next: (snapshot: UploadSnapshot) => calls.push(`next:${snapshot.status}:${String(snapshot.value)}`),
      complete: () => calls.push('complete'),
    });

    // Whatever the preview showed before, the actor's ending comes last, in XState's order, once each.
    expect(calls.slice(-2)).toEqual(['next:done:uploaded', 'complete']);
    expect(calls.filter((call) => call === 'next:done:uploaded' || call === 'complete')).toEqual([
      'next:done:uploaded',
      'complete',
    ]);

    const ended = [...calls];
    await previewAgain();
    expect(calls).toEqual(ended);
  });
});
