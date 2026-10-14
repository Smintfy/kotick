// The observer given to useActorRef hears how the real actor ended once no preview hides the real snapshot (spec §10.2,
// "Observers and the actor's ending"; R13). When the app stops the actor while a preview shows (actorRef.stop(), say a
// Cancel button; stop() isn't an event, so the preview doesn't block it), XState calls the observer's complete at once,
// and the proxy holds it back until the preview is released: the observer hears complete then, exactly once. Apps
// usually pass an inline observer, a new one on every render, which @xstate/react subscribes again each time, and XState
// calls nothing on an observer subscribed to a stopped actor. So the held-back ending is kept per hook, not per observer
// identity: when the component re-renders before the release (a parent, or a useSelector of the same actor following
// the developer to another preview), the observer of the latest render hears complete on the release. A stable observer
// hears it the same way, and nothing reaches either afterwards, not even later previews of the stopped actor. With
// @xstate/react, which has no previews, the observer hears complete when the app stops the actor.

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createMachine, type Actor, type Observer, type SnapshotFrom } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

const uploadMachine = createMachine({
  id: 'upload',
  initial: 'uploading',
  states: {
    uploading: { on: { UPLOADED: 'uploaded' } },
    failed: {},
    uploaded: { type: 'final' },
  },
});

type UploadActor = Actor<typeof uploadMachine>;
type UploadSnapshot = SnapshotFrom<typeof uploadMachine>;
type Hooks = Pick<typeof xstateReact, 'useActorRef' | 'useSelector'>;

const IMPLEMENTATIONS: [name: string, hooks: Hooks, previews: boolean][] = [
  ['@xstate/react (control)', xstateReact, false],
  ['state-viewer/xstate', stateViewer as unknown as Hooks, true],
];

/** A new observer on every render, as apps usually write it, or the first render's throughout. */
const OBSERVERS: [name: string, stable: boolean][] = [
  ['an inline observer', false],
  ['a stable observer', true],
];

/**
 * An observer that logs each call it gets, tagged with what the component rendered when it made the observer, so the
 * log tells which render's observer heard it.
 */
function logTo(calls: string[], tag: () => string): Observer<UploadSnapshot> {
  return {
    next: (snapshot) => calls.push(`${tag()}: next ${snapshot.status} ${String(snapshot.value)}`),
    complete: () => calls.push(`${tag()}: complete`),
  };
}

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
  /** Previews `leaves` on the upload, as someone in the overlay would; only the adapter registers it. */
  function preview(leaves: string[]): void {
    if (previews) act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves }));
  }

  function release(): void {
    if (previews) act(() => registry().release());
  }

  describe.each(OBSERVERS)('%s', (_kind, stable) => {
    /** This render's observer, or with `stable`, the first render's. */
    function useObserver(observer: Observer<UploadSnapshot>): Observer<UploadSnapshot> {
      const [first] = useState(observer);
      return stable ? first : observer;
    }

    /**
     * Renders an upload whose observer is tagged with the hint its parent passed, previews `failed`, and has the app
     * stop the actor underneath (the user cancels). `calls` logs from the stop on. Returns a parent re-render.
     */
    async function cancelDuringPreview(calls: string[]): Promise<(hint: string) => void> {
      let actorRef: UploadActor | undefined;
      function Upload({ hint }: { hint: string }) {
        const observer = useObserver(logTo(calls, () => hint));
        actorRef = hooks.useActorRef(uploadMachine, undefined, observer);
        return <p>{hint}</p>;
      }
      const { rerender } = render(<Upload hint="Uploading" />);
      await flush();
      preview(['failed']);
      await flush();

      calls.length = 0;
      calls.push('[app stops]');
      act(() => {
        actorRef!.stop();
      });
      await flush();
      return (hint) => rerender(<Upload hint={hint} />);
    }

    /** After the release: the parent re-renders the component again, and the developer looks at another state. */
    async function afterwards(calls: string[], rerender: (hint: string) => void): Promise<void> {
      calls.push('[afterwards]');
      rerender('Closed');
      await flush();
      preview(['uploaded']);
      await flush();
      release();
      await flush();
    }

    test('hears complete once when the app stops the actor during a preview', async () => {
      const calls: string[] = [];
      const rerender = await cancelDuringPreview(calls);
      calls.push('[release]');
      release();
      await flush();
      await afterwards(calls, rerender);

      expect(calls).toEqual(
        previews
          ? ['[app stops]', '[release]', 'Uploading: complete', '[afterwards]']
          : ['[app stops]', 'Uploading: complete', '[release]', '[afterwards]'],
      );
    });

    test('hears complete once when, after the app stops the actor, a parent re-renders the component before the release', async () => {
      const calls: string[] = [];
      const rerender = await cancelDuringPreview(calls);
      calls.push('[parent re-renders]');
      rerender('Cancelled');
      await flush();
      calls.push('[release]');
      release();
      await flush();
      await afterwards(calls, rerender);

      expect(calls).toEqual(
        previews
          ? [
              '[app stops]',
              '[parent re-renders]',
              '[release]',
              // The observer @xstate/react has subscribed by then: the re-render's, unless the observer is stable.
              `${stable ? 'Uploading' : 'Cancelled'}: complete`,
              '[afterwards]',
            ]
          : ['[app stops]', 'Uploading: complete', '[parent re-renders]', '[release]', '[afterwards]'],
      );
    });

    test('hears complete once when, after the app stops the actor, a useSelector re-renders the component on another preview before the release', async () => {
      const calls: string[] = [];
      let actorRef: UploadActor | undefined;
      function Upload() {
        // What this render shows, assigned below; the observer reads it when called.
        let shown = '';
        const observer = useObserver(logTo(calls, () => shown));
        const ref = hooks.useActorRef(uploadMachine, undefined, observer);
        actorRef = ref;
        shown = hooks.useSelector(ref, (snapshot) => String(snapshot.value));
        return <p>{shown}</p>;
      }
      const view = render(<Upload />);
      await flush();
      preview(['failed']);
      await flush();

      calls.length = 0;
      calls.push('[app stops]');
      act(() => {
        actorRef!.stop();
      });
      await flush();
      // The developer clicks another state: useSelector re-renders the component, which passes a new observer.
      calls.push('[preview of uploaded]');
      preview(['uploaded']);
      await flush();
      if (previews) expect(view.container.textContent).toBe('uploaded');
      calls.push('[release]');
      release();
      await flush();
      calls.push('[afterwards]');
      preview(['failed']);
      await flush();
      release();
      await flush();

      expect(view.container.textContent).toBe('uploading');
      expect(calls).toEqual(
        previews
          ? [
              '[app stops]',
              '[preview of uploaded]',
              // Until it hears how the actor ended, the observer follows previews: here the one made under `failed`.
              `${stable ? 'uploading' : 'failed'}: next done uploaded`,
              '[release]',
              `${stable ? 'uploading' : 'uploaded'}: complete`,
              '[afterwards]',
            ]
          : ['[app stops]', 'uploading: complete', '[preview of uploaded]', '[release]', '[afterwards]'],
      );
    });
  });
});
