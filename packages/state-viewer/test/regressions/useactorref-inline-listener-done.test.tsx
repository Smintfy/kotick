// The observer given to useActorRef hears how the real actor ended, as with @xstate/react, even when the actor
// finished while a preview hid it and the component re-rendered before the preview was released (spec §10.2; R13).
// Apps usually pass an inline listener, a new function on every render, which @xstate/react subscribes again each
// time: the done snapshot the preview held back reaches the listener of the latest render once the preview is
// released, once. That holds whatever re-renders the component meanwhile, a parent or a prop, or a useSelector of the
// same actor following the developer from one preview to another.

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import { useCallback, type ReactElement } from 'react';
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

const URL = 'https://cdn/x.png';

type UploadSnapshot = SnapshotFrom<typeof uploadMachine>;
type Hooks = Pick<typeof xstateReact, 'useActorRef' | 'useSelector'>;

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

  function release(): void {
    if (previews) act(() => registry().release());
  }

  /**
   * A component whose listener collects the url of each done snapshot: a new function every render, as apps usually
   * write it, or with `stable`, the same one throughout.
   */
  function uploadWithListener(uploaded: string[], { stable = false } = {}) {
    return function Upload({ hint }: { hint: string }) {
      const listener = useCallback(
        (snapshot: UploadSnapshot) => {
          if (snapshot.status === 'done') uploaded.push(snapshot.context.url);
        },
        [],
      );
      hooks.useActorRef(uploadMachine, undefined, stable ? listener : (snapshot: UploadSnapshot) => listener(snapshot));
      return <p>{hint}</p>;
    };
  }

  /**
   * Renders `Upload`, finishes the upload underneath a preview of `failed`, re-renders the component with a new prop,
   * as a parent's state change would, and releases the preview.
   */
  async function finishThenRerender(Upload: (props: { hint: string }) => ReactElement): Promise<void> {
    const { rerender } = render(<Upload hint="Uploading" />);
    await flush();

    preview(['failed']);
    // The real actor keeps running underneath (R13) and finishes.
    act(() => finishUpload?.());
    rerender(<Upload hint="Still uploading" />);
    await flush();
    release();
    await flush();
  }

  test('control: without a preview, an inline listener hears the upload finish once', async () => {
    const uploaded: string[] = [];
    const Upload = uploadWithListener(uploaded);
    const { rerender } = render(<Upload hint="Uploading" />);
    await flush();

    act(() => finishUpload?.());
    rerender(<Upload hint="Still uploading" />);
    await flush();

    expect(uploaded).toEqual([URL]);
  });

  test('an inline listener hears the upload finish once, though the component re-rendered before the release', async () => {
    const uploaded: string[] = [];
    await finishThenRerender(uploadWithListener(uploaded));

    expect(uploaded).toEqual([URL]);
  });

  test('a stable listener (useCallback) hears the upload finish once, with the same re-render', async () => {
    const uploaded: string[] = [];
    await finishThenRerender(uploadWithListener(uploaded, { stable: true }));

    expect(uploaded).toEqual([URL]);
  });

  test('an inline observer object gets the done snapshot once, and only complete after it', async () => {
    const calls: string[] = [];
    function Upload({ hint }: { hint: string }) {
      hooks.useActorRef(uploadMachine, undefined, {
        next: (snapshot: UploadSnapshot) => calls.push(`next:${snapshot.status}:${String(snapshot.value)}`),
        complete: () => calls.push('complete'),
      });
      return <p>{hint}</p>;
    }
    await finishThenRerender(Upload);

    const done = calls.indexOf('next:done:uploaded');
    expect(calls.filter((call) => call === 'next:done:uploaded')).toEqual(['next:done:uploaded']);
    // @xstate/react completes the observer of each render it subscribed after the actor ended, so complete may repeat.
    const after = calls.slice(done + 1);
    expect(after.length).toBeGreaterThan(0);
    expect(new Set(after)).toEqual(new Set(['complete']));
  });

  test('an inline listener hears it when useSelector in the same component follows the preview', async () => {
    const uploaded: string[] = [];
    function Upload() {
      const actorRef = hooks.useActorRef(uploadMachine, undefined, (snapshot: UploadSnapshot) => {
        if (snapshot.status === 'done') uploaded.push(snapshot.context.url);
      });
      const value = hooks.useSelector(actorRef, (snapshot) => String(snapshot.value));
      return <p>{value}</p>;
    }
    const view = render(<Upload />);
    await flush();

    preview(['failed']);
    await flush();
    act(() => finishUpload?.());
    await flush();
    // The developer clicks another state: the component re-renders through useSelector.
    preview(['uploading']);
    await flush();
    if (previews) expect(view.container.textContent).toBe('uploading');
    release();
    await flush();

    expect(view.container.textContent).toBe('uploaded');
    expect(uploaded).toEqual([URL]);
  });
});
