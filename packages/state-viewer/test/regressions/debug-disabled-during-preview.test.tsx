// When a component turns `debug.disabled` on while a preview shows (a dev toggle that takes the actor out of the
// debugger), the hook stops previewing the actor in that render, and the observer given to useActorRef leaves the
// preview as it would on a release. It is shown
// the real snapshot when the actor is still running; when the actor finished while the preview hid its ending, it
// gets the done snapshot, then complete, in XState's order and once. Nothing is left owed to a registry flush that
// no longer reaches the observer, so an app's "on done" side effect still runs. From then on the observer follows the
// real actor as @xstate/react's does. This holds for inline and stable listeners and observer objects.

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import { useCallback, useMemo } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { assign, fromCallback, setup, type Observer, type SnapshotFrom } from 'xstate';
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
      on: {
        UPLOADED: {
          target: 'uploaded',
          actions: assign({ url: 'https://cdn/x.png' }),
        },
      },
    },
    failed: {},
    uploaded: { type: 'final' },
  },
});

type UploadSnapshot = SnapshotFrom<typeof uploadMachine>;
type UploadObserver = Observer<UploadSnapshot> | ((snapshot: UploadSnapshot) => void);
type Hooks = Pick<typeof xstateReact, 'useActorRef'>;

const IMPLEMENTATIONS: [name: string, hooks: Hooks, previews: boolean][] = [
  ['@xstate/react (control)', xstateReact, false],
  ['state-viewer/xstate', stateViewer as unknown as Hooks, true],
];

const LISTENERS: [name: string, stable: boolean][] = [
  ['an inline listener', false],
  ['a stable listener (useCallback)', true],
];

const OBSERVER_OBJECTS: [name: string, stable: boolean][] = [
  ['an inline observer object', false],
  ['a stable observer object (useMemo)', true],
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
  /**
   * Mounts the upload with useActorRef and the observer `kind` makes, which records each snapshot as `status:value`
   * and complete as `complete`. `take()` returns what it heard since the last call; `disable()` renders the component
   * with `debug.disabled`, the first time turning it on.
   */
  async function mount(kind: 'listener' | 'object', stable: boolean) {
    let heard: string[] = [];
    function useObserver(): UploadObserver {
      const listener = useCallback((snapshot: UploadSnapshot) => {
        heard.push(`${snapshot.status}:${String(snapshot.value)}`);
      }, []);
      const object = useMemo(() => ({ next: listener, complete: () => heard.push('complete') }), [listener]);
      if (kind === 'listener') return stable ? listener : (snapshot: UploadSnapshot) => listener(snapshot);
      return stable
        ? object
        : {
            next: (snapshot: UploadSnapshot) => listener(snapshot),
            complete: object.complete,
          };
    }
    function Upload({ disabled }: { disabled: boolean }) {
      hooks.useActorRef(uploadMachine, { debug: { disabled } } as never, useObserver());
      return null;
    }
    const view = render(<Upload disabled={false} />);
    await flush();
    const take = (): string[] => {
      const taken = heard;
      heard = [];
      return taken;
    };
    // Under StrictMode @xstate/react starts the actor twice, and the observer hears each start.
    expect(take()).toEqual(['active:uploading', 'active:uploading']);
    return { take, disable: () => view.rerender(<Upload disabled />) };
  }

  /** Previews `failed` on the upload, as someone in the overlay would; only the adapter registers it. */
  async function previewFailed(): Promise<void> {
    if (previews) act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves: ['failed'] }));
    await flush();
  }

  /** Later flushes, where the registry drops a preview it kept, and a later render with debug still disabled. */
  async function settle(disable: () => void): Promise<void> {
    await flush();
    await flush();
    disable();
    await flush();
  }

  /** Entries in first-seen order: a preview can be shown again when the real actor moves underneath it. */
  const distinct = (entries: string[]): string[] => [...new Set(entries)];

  describe('when the actor finished under the preview', () => {
    test.each(LISTENERS)(
      '%s gets the done snapshot as debug is disabled, and nothing after it',
      async (_kind, stable) => {
        const { take, disable } = await mount('listener', stable);

        await previewFailed();
        // The real actor keeps running underneath and finishes; the preview hides the ending.
        act(() => finishUpload?.());
        await flush();
        expect(distinct(take())).toEqual(previews ? ['active:failed'] : ['done:uploaded']);

        disable();
        expect(registry().getSnapshot().machines).toEqual([]);
        expect(take()).toEqual(previews ? ['done:uploaded'] : []);

        await settle(disable);
        expect(take()).toEqual([]);
      },
    );

    test.each(OBSERVER_OBJECTS)(
      '%s gets the done snapshot, then complete, as debug is disabled',
      async (_kind, stable) => {
        const { take, disable } = await mount('object', stable);
        // @xstate/react subscribes an inline observer again on each render, and XState completes it at once, as the
        // actor is done.
        const resubscribed = stable ? [] : ['complete'];

        await previewFailed();
        act(() => finishUpload?.());
        await flush();
        expect(distinct(take())).toEqual(previews ? ['active:failed'] : ['done:uploaded', 'complete']);

        disable();
        expect(registry().getSnapshot().machines).toEqual([]);
        expect(take()).toEqual([...(previews ? ['done:uploaded', 'complete'] : []), ...resubscribed]);

        await settle(disable);
        expect(take()).toEqual(resubscribed);
      },
    );
  });

  describe('when the actor is still running', () => {
    test.each(LISTENERS)(
      '%s is shown the real snapshot as debug is disabled, then follows the actor',
      async (_kind, stable) => {
        const { take, disable } = await mount('listener', stable);

        await previewFailed();
        expect(take()).toEqual(previews ? ['active:failed'] : []);

        disable();
        expect(registry().getSnapshot().machines).toEqual([]);
        expect(take()).toEqual(previews ? ['active:uploading'] : []);

        await settle(disable);
        expect(take()).toEqual([]);

        act(() => finishUpload?.());
        await flush();
        expect(take()).toEqual(['done:uploaded']);
      },
    );

    test.each(OBSERVER_OBJECTS)(
      '%s is shown the real snapshot as debug is disabled, then follows the actor',
      async (_kind, stable) => {
        const { take, disable } = await mount('object', stable);

        await previewFailed();
        expect(take()).toEqual(previews ? ['active:failed'] : []);

        disable();
        expect(registry().getSnapshot().machines).toEqual([]);
        expect(take()).toEqual(previews ? ['active:uploading'] : []);

        await settle(disable);
        expect(take()).toEqual([]);

        act(() => finishUpload?.());
        await flush();
        expect(take()).toEqual(['done:uploaded', 'complete']);
      },
    );
  });
});
