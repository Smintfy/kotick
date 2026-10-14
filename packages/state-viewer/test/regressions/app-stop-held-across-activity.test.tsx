// When the app stops a hook's actor while a preview shows (actorRef.stop(), say a Cancel button; stop() isn't an
// event, so the preview doesn't block it), the hook holds the ending back until no preview hides the real snapshot
// (spec §10.2, "Observers and the actor's ending"; R13). If an <Activity> hides the component (a tab switch) before
// then, @xstate/react stops the actor and drops its observers, the hook stops listening to previews and unregisters,
// and the preview ends while nothing hears it: the registry drops the unregistered instance's preview at its next
// flush, or the developer releases it first. When the Activity reveals the component, @xstate/react subscribes the
// observers again and restarts the actor, which tells a stopped actor's observers nothing (it repeats only a finished
// or failed actor's ending). So the hook delivers the held ending itself when it connects again: the observer given to
// useActorRef hears complete, once, by the time the component is revealed, and useMachine shows the real stopped
// snapshot. Both have then been told the actor stopped, so a later preview of the machine reaches neither, as with
// @xstate/react, which has no previews: the observer gets no previews once the actor stops, and the hooks' store none
// once the actor is stopped. This holds for an inline observer, a new one on every render, as the ending is held per
// hook rather than per observer.

import { act, render, screen } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import * as React from 'react';
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
    paused: {},
    uploaded: { type: 'final' },
  },
});

type UploadActor = Actor<typeof uploadMachine>;
type UploadSnapshot = SnapshotFrom<typeof uploadMachine>;
type Hooks = Pick<typeof xstateReact, 'useActorRef' | 'useMachine'>;

const IMPLEMENTATIONS: [name: string, hooks: Hooks, previews: boolean][] = [
  ['@xstate/react (control)', xstateReact, false],
  ['state-viewer/xstate', stateViewer as unknown as Hooks, true],
];

/** How the preview the app stopped the actor under ends while the component is hidden. */
const PREVIEW_ENDINGS: [how: string, releaseWhileHidden: boolean][] = [
  ['the registry drops it at its next flush', false],
  ['the developer releases it before that flush', true],
];

/** A new observer on every render, as apps usually write it, or the first render's throughout. */
const OBSERVERS: [name: string, stable: boolean][] = [
  ['an inline observer', false],
  ['a stable observer', true],
];

const Activity = (
  React as unknown as { Activity: React.ComponentType<{ mode: 'visible' | 'hidden'; children: React.ReactNode }> }
).Activity;

const label = (snapshot: { status: string; value: unknown }): string => `${snapshot.status}:${String(snapshot.value)}`;

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
    if (!previews) return;
    const key = keyOf(onlyHandle('upload'));
    act(() => registry().preview(key, { leaves }));
    expect(registry().getOverride(key)).toBeDefined();
  }

  function release(): void {
    if (previews) act(() => registry().release());
  }

  describe.each(PREVIEW_ENDINGS)('the preview ends while an Activity hides the upload: %s', (_, releaseWhileHidden) => {
    /**
     * Mounts `Upload` in an Activity, previews `failed`, and has the app stop the actor underneath (the user cancels).
     * Then a tab switch hides the upload, the preview ends meanwhile, and the upload is shown again. `log` gets a
     * marker before each step.
     */
    async function cancelThenHideAndReveal(
      Upload: () => React.ReactNode,
      getActor: () => UploadActor | undefined,
      log: string[] = [],
    ): Promise<void> {
      function App({ mode }: { mode: 'visible' | 'hidden' }) {
        return (
          <Activity mode={mode}>
            <Upload />
          </Activity>
        );
      }
      const view = render(<App mode="visible" />);
      await flush();
      preview(['failed']);
      await flush();

      log.length = 0;
      log.push('[app stops]');
      act(() => {
        getActor()!.stop();
      });
      await flush();
      log.push('[hide]');
      view.rerender(<App mode="hidden" />);
      if (releaseWhileHidden) release();
      await flush();
      await flush();
      expect(registry().getSnapshot().overrides).toEqual({});
      log.push('[reveal]');
      view.rerender(<App mode="visible" />);
      await flush();
    }

    describe.each(OBSERVERS)('%s given to useActorRef', (_kind, stable) => {
      test('hears complete once by the reveal, and nothing of a later preview of the stopped actor', async () => {
        const calls: string[] = [];
        let actorRef: UploadActor | undefined;
        function Upload() {
          const inline: Observer<UploadSnapshot> = {
            next: (snapshot) => calls.push(`next:${label(snapshot)}`),
            complete: () => calls.push('complete'),
          };
          const [first] = React.useState(inline);
          actorRef = hooks.useActorRef(uploadMachine, undefined, stable ? first : inline);
          return null;
        }
        await cancelThenHideAndReveal(Upload, () => actorRef, calls);

        // Later the developer looks at the upload machine again, and closes the overlay.
        calls.push('[later preview]');
        preview(['paused']);
        await flush();
        calls.push('[later release]');
        release();
        await flush();

        expect(calls).toEqual(
          previews
            ? ['[app stops]', '[hide]', '[reveal]', 'complete', '[later preview]', '[later release]']
            : ['[app stops]', 'complete', '[hide]', '[reveal]', '[later preview]', '[later release]'],
        );
      });
    });

    test('useMachine shows the stopped snapshot from the reveal on, and nothing of a later preview', async () => {
      let actorRef: UploadActor | undefined;
      function Upload() {
        const [snapshot, , ref] = hooks.useMachine(uploadMachine);
        actorRef = ref as UploadActor;
        return <output>{label(snapshot)}</output>;
      }
      const shown = (): string | null => screen.getByRole('status').textContent;
      await cancelThenHideAndReveal(Upload, () => actorRef);
      expect(shown()).toBe('stopped:uploading');

      preview(['paused']);
      await flush();
      expect(shown()).toBe('stopped:uploading');

      release();
      await flush();
      expect(shown()).toBe('stopped:uploading');
    });
  });
});
