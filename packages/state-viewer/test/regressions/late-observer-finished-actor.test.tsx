// A component passes its observer to useActorRef only while a panel is open (`panelOpen ? onChange : undefined`, the
// conditional-listener pattern of test/regressions/debug-disabled-without-preview.test.tsx). The upload finishes, or
// fails, while the panel is closed. The developer previews the finished upload in the overlay (hooks keep a finished
// actor listed), the user opens the panel, the developer clicks another state, and closes the overlay.
//
// @xstate/react subscribes the observer to an actor XState has already stopped: XState calls the observer's complete
// (or error) at once and nothing else, and calls nothing at all on a listener function.
// An observer passed to useActorRef gets no previews once the actor is done, fails or stops, as with @xstate/react.
// It still hears what XState sends it afterwards.
// The hook holds back no such ending.
// It holds back an ending only from an observer that follows the preview as the actor ends.
// So the observer is shown no preview of the finished machine and no done snapshot on the release: an onChange that
// toasts on `status === 'done'` doesn't fire when the overlay closes.

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createMachine, type AnyActorRef, type Observer, type SnapshotFrom } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

const uploadMachine = createMachine({
  id: 'upload',
  initial: 'uploading',
  states: {
    uploading: {
      on: {
        UPLOADED: 'uploaded',
        BREAK: {
          actions: () => {
            throw new Error('broken');
          },
        },
      },
    },
    paused: {},
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
  // Previews of states without a recording or fixture warn about falling back to live context.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

describe.each(IMPLEMENTATIONS)('%s', (_name, hooks, previews) => {
  /** Mounts the upload, passing `listen` to useActorRef while the panel is open. */
  function mountUpload(calls: string[], listen: Observer<UploadSnapshot> | ((snapshot: UploadSnapshot) => void)) {
    let actorRef: AnyActorRef | undefined;
    function Upload({ panelOpen }: { panelOpen: boolean }) {
      actorRef = hooks.useActorRef(uploadMachine, undefined, panelOpen ? listen : undefined) as AnyActorRef;
      return null;
    }
    const view = render(<Upload panelOpen={false} />);
    return {
      send: (type: 'UPLOADED' | 'BREAK') => act(() => actorRef!.send({ type })),
      setPanel: async (panelOpen: boolean): Promise<void> => {
        view.rerender(<Upload panelOpen={panelOpen} />);
        await flush();
      },
      preview: async (leaf: string): Promise<void> => {
        calls.push(`[preview ${leaf}]`);
        if (previews) act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves: [leaf] }));
        await flush();
      },
      release: async (): Promise<void> => {
        calls.push('[release]');
        if (previews) act(() => registry().release());
        await flush();
      },
    };
  }

  const label = (snapshot: UploadSnapshot): string => `${snapshot.status}:${String(snapshot.value)}`;

  test('a listener passed after the upload finished hears nothing', async () => {
    const calls: string[] = [];
    const upload = mountUpload(calls, (snapshot) => calls.push(label(snapshot)));
    await flush();
    upload.send('UPLOADED');
    await flush();

    await upload.preview('failed');
    calls.push('[panel opens]');
    await upload.setPanel(true);
    await upload.preview('paused');
    await upload.release();

    expect(calls).toEqual(['[preview failed]', '[panel opens]', '[preview paused]', '[release]']);
  });

  test('an observer passed after the upload finished hears complete only, at once', async () => {
    const calls: string[] = [];
    const upload = mountUpload(calls, {
      next: (snapshot) => calls.push(label(snapshot)),
      complete: () => calls.push('complete'),
    });
    await flush();
    upload.send('UPLOADED');
    await flush();

    await upload.preview('failed');
    calls.push('[panel opens]');
    await upload.setPanel(true);
    await upload.preview('paused');
    await upload.release();

    expect(calls).toEqual(['[preview failed]', '[panel opens]', 'complete', '[preview paused]', '[release]']);
  });

  test('an observer shown the upload before the panel closed hears only complete when it reopens', async () => {
    const calls: string[] = [];
    const upload = mountUpload(calls, {
      next: (snapshot) => calls.push(label(snapshot)),
      complete: () => calls.push('complete'),
    });
    await flush();
    await upload.setPanel(true);
    await upload.preview('paused');
    await upload.release();
    await upload.setPanel(false);
    upload.send('UPLOADED');
    await flush();
    calls.length = 0;

    await upload.preview('failed');
    calls.push('[panel opens]');
    await upload.setPanel(true);
    await upload.preview('paused');
    await upload.release();

    expect(calls).toEqual(['[preview failed]', '[panel opens]', 'complete', '[preview paused]', '[release]']);
  });

  test('an error callback passed after the upload failed hears the error at once', async () => {
    const calls: string[] = [];
    const upload = mountUpload(calls, {
      next: (snapshot) => calls.push(label(snapshot)),
      error: (error) => calls.push(`error:${(error as Error).message}`),
    });
    await flush();
    // XState reports the failure as unhandled from a timer, as no observer has an error callback yet.
    const timers = vi.spyOn(globalThis, 'setTimeout').mockImplementation((() => 0) as never);
    upload.send('BREAK');
    timers.mockRestore();
    await flush();

    await upload.preview('failed');
    calls.push('[panel opens]');
    await upload.setPanel(true);
    await upload.preview('paused');
    await upload.release();

    expect(calls).toEqual(['[preview failed]', '[panel opens]', 'error:broken', '[preview paused]', '[release]']);
  });
});
