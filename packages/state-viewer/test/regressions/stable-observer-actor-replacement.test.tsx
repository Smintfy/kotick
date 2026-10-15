// @xstate/react subscribes the observer given to useActorRef in an effect keyed only on the observer.
// When the component gets a new machine config (an edit to the machine's module
// that Fast Refresh applies, a machine built from props), @xstate/react replaces the actor, carrying its snapshot over,
// and stops the old one. An inline observer, a new one on every render, is subscribed to each new actor and follows
// it: it hears the new actor's real updates, and state-viewer shows it the new actor's previews (none once it has
// heard the upload finish). A stable observer, one the component keeps across renders (useCallback, useState), stays
// subscribed to the replaced actor, which tells it nothing more. state-viewer leaves it there too: a preview stands in
// for the real snapshot an observer hears, so the new actor's previews don't reach an observer that hears none of its
// real updates. After a finished upload it hears neither a preview nor the done snapshot again, so a
// `status === 'done'` handler (a toast, a redirect) doesn't run twice; while the upload runs it hears no previews, as
// it hears no real updates. When its effects run again (an Activity reveals the component, and StrictMode replays them
// on the reveal), @xstate/react subscribes it to the new actor: from then on it hears the new actor's real updates,
// and state-viewer shows it the new actor's previews too, the real snapshot coming back on the release.

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import * as React from 'react';
import { useCallback } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createMachine, type Actor, type SnapshotFrom } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

/** A fresh machine object from a fresh config each call, as Fast Refresh re-evaluating the module gives. */
function createUploadMachine() {
  return createMachine({
    id: 'upload',
    initial: 'uploading',
    states: {
      uploading: { on: { UPLOADED: 'uploaded' } },
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

const Activity = (
  React as unknown as { Activity: React.ComponentType<{ mode: 'visible' | 'hidden'; children: React.ReactNode }> }
).Activity;

const label = (snapshot: UploadSnapshot): string => `${snapshot.status}:${String(snapshot.value)}`;

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
  /**
   * Mounts the upload in an Activity, with useActorRef and a stable observer (useCallback) or an inline one, which
   * records each snapshot it hears as `status:value` in `calls`. `calls` starts empty after the mount, and each step
   * pushes a marker before it acts, so `calls` shows what the observer heard after which step.
   */
  async function mountUpload(stable: boolean) {
    const calls: string[] = [];
    let actorRef: Actor<UploadMachine> | undefined;
    function Upload({ machine }: { machine: UploadMachine }) {
      const stableObserver = useCallback((snapshot: UploadSnapshot) => {
        calls.push(label(snapshot));
      }, []);
      const inlineObserver = (snapshot: UploadSnapshot): void => {
        calls.push(label(snapshot));
      };
      actorRef = hooks.useActorRef(machine, undefined, stable ? stableObserver : inlineObserver);
      return null;
    }

    type Props = { machine: UploadMachine; mode: 'visible' | 'hidden' };
    function App({ machine, mode }: Props) {
      return (
        <Activity mode={mode}>
          <Upload machine={machine} />
        </Activity>
      );
    }
    const props: Props = { machine: createUploadMachine(), mode: 'visible' };
    const view = render(<App {...props} />);
    const update = async (patch: Partial<Props>): Promise<void> => {
      Object.assign(props, patch);
      view.rerender(<App {...props} />);
      await flush();
    };
    await flush();
    // Under StrictMode @xstate/react starts the actor twice, and the observer hears each start.
    expect(calls.splice(0)).toEqual(['active:uploading', 'active:uploading']);

    return {
      calls,
      /** The user finishes the upload. */
      send: async (): Promise<void> => {
        calls.push('[send]');
        act(() => actorRef!.send({ type: 'UPLOADED' }));
        await flush();
      },
      /**
       * The developer edits the machine's module: Fast Refresh renders the upload with a new machine object, and
       * @xstate/react replaces the actor.
       */
      replace: async (): Promise<void> => {
        calls.push('[replace]');
        const replaced = actorRef;
        await update({ machine: createUploadMachine() });
        expect(actorRef).not.toBe(replaced);
      },
      /** Previews `failed` on the upload, as someone in the overlay would; only the adapter registers it. */
      preview: async (): Promise<void> => {
        calls.push('[preview]');
        if (previews) {
          const key = keyOf(onlyHandle('upload'));
          act(() => registry().preview(key, { leaves: ['failed'] }));
          expect(registry().getOverride(key)).toBeDefined();
        }
        await flush();
      },
      /** Closes the overlay, ending the preview. */
      release: async (): Promise<void> => {
        calls.push('[release]');
        if (previews) act(() => registry().release());
        await flush();
      },
      /**
       * A tab switch hides the upload, and switching back reveals it. StrictMode replays the effects on the reveal, so
       * @xstate/react subscribes the observer and starts the actor twice.
       */
      hideAndReveal: async (): Promise<void> => {
        calls.push('[hide+reveal]');
        await update({ mode: 'hidden' });
        await update({ mode: 'visible' });
      },
    };
  }

  describe('the actor is replaced while the upload runs', () => {
    test('a stable observer stays with the replaced actor: none of the new actor’s previews or updates', async () => {
      const upload = await mountUpload(true);
      await upload.replace();
      await upload.preview();
      await upload.release();
      await upload.send();

      expect(upload.calls).toEqual(['[replace]', '[preview]', '[release]', '[send]']);
    });

    test('an inline observer follows the new actor: previews, the real snapshot on release, updates', async () => {
      const upload = await mountUpload(false);
      await upload.replace();
      await upload.preview();
      await upload.release();
      await upload.send();

      expect(upload.calls).toEqual(
        previews
          ? [
              '[replace]', 'active:uploading',
              '[preview]', 'active:failed',
              '[release]', 'active:uploading',
              '[send]', 'done:uploaded',
            ]
          : ['[replace]', 'active:uploading', '[preview]', '[release]', '[send]', 'done:uploaded'],
      );
    });
  });

  describe('the actor is replaced after the upload finished', () => {
    test('a stable observer that heard the upload finish hears no preview and no done snapshot again', async () => {
      const upload = await mountUpload(true);
      await upload.send();
      await upload.replace();
      await upload.preview();
      await upload.release();

      expect(upload.calls).toEqual(['[send]', 'done:uploaded', '[replace]', '[preview]', '[release]']);
    });

    test('an inline observer hears the new actor’s done snapshot, then no preview of it', async () => {
      const upload = await mountUpload(false);
      await upload.send();
      await upload.replace();
      await upload.preview();
      await upload.release();

      expect(upload.calls).toEqual(['[send]', 'done:uploaded', '[replace]', 'done:uploaded', '[preview]', '[release]']);
    });
  });

  describe('an Activity reveal subscribes the stable observer to the new actor', () => {
    test('previewed before the reveal: it hears the new actor’s updates and previews from then on', async () => {
      const upload = await mountUpload(true);
      await upload.replace();
      await upload.preview();
      await upload.release();
      await upload.hideAndReveal();
      await upload.preview();
      await upload.release();
      await upload.send();

      expect(upload.calls).toEqual(
        previews
          ? [
              '[replace]', '[preview]', '[release]',
              '[hide+reveal]', 'active:uploading', 'active:uploading',
              '[preview]', 'active:failed',
              '[release]', 'active:uploading',
              '[send]', 'done:uploaded',
            ]
          : [
              '[replace]', '[preview]', '[release]',
              '[hide+reveal]', 'active:uploading', 'active:uploading',
              '[preview]', '[release]',
              '[send]', 'done:uploaded',
            ],
      );
    });

    test('not previewed before the reveal: it hears the new actor’s updates and previews from then on', async () => {
      const upload = await mountUpload(true);
      await upload.replace();
      await upload.hideAndReveal();
      await upload.preview();
      await upload.release();
      await upload.send();

      expect(upload.calls).toEqual(
        previews
          ? [
              '[replace]',
              '[hide+reveal]', 'active:uploading', 'active:uploading',
              '[preview]', 'active:failed',
              '[release]', 'active:uploading',
              '[send]', 'done:uploaded',
            ]
          : [
              '[replace]',
              '[hide+reveal]', 'active:uploading', 'active:uploading',
              '[preview]', '[release]',
              '[send]', 'done:uploaded',
            ],
      );
    });
  });
});
