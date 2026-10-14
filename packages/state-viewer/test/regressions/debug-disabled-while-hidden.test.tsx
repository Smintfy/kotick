// When the app stops a hook's actor while a preview shows (actorRef.stop(), say a Cancel button), the hook holds the
// ending back from the observer given to useActorRef until no preview hides the real snapshot (spec §10.2, "Observers
// and the actor's ending" and "Lifecycle"; R13). An <Activity> then hides the component (a tab switch): @xstate/react
// stops the actor, the hook stops listening to previews and unregisters, and the registry drops the unregistered
// instance's preview at its next flush, with nothing listening. A dev toggle then turns `debug.disabled` on, flipped
// on another tab while the Activity hides the component, or in the render that reveals it. The hook no longer
// previews the actor, which is a release for the observer, so the hook delivers the held ending itself on the reveal,
// in the layout phase: @xstate/react restarts the actor after that, and XState tells a stopped actor's observers
// nothing when it starts again. The observer hears complete once, by the reveal, and nothing more on later renders or
// when debug is turned on again, with and without StrictMode, for an inline observer and a stable one, so an app's
// "on cancelled" side effect runs. @xstate/react, which has no previews, tells it at the stop. With debug left on, the
// hook delivers the held ending as its preview listener connects again on the reveal, with the same result.
//
// When the actor finishes during the preview instead (an invoked socket answers), the hook delivers the done snapshot
// and complete on the reveal the same way, then @xstate/react's restart repeats them, as XState does whenever a
// finished actor starts again. The observer hears the ending as many times in all as with @xstate/react, which tells
// it once at the finish and again on each restart.

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fromCallback, setup, type Actor, type Observer, type SnapshotFrom } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

/** What the invoked callback actor uses to tell its parent the upload finished, as a socket would. */
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
  states: {
    uploading: {
      invoke: { src: 'socket' },
      on: { UPLOADED: 'uploaded' },
    },
    failed: {},
    uploaded: { type: 'final' },
  },
});

type UploadActor = Actor<typeof uploadMachine>;
type UploadSnapshot = SnapshotFrom<typeof uploadMachine>;
type Hooks = Pick<typeof xstateReact, 'useActorRef'>;

const IMPLEMENTATIONS: [name: string, hooks: Hooks, previews: boolean][] = [
  ['@xstate/react (control)', xstateReact, false],
  ['state-viewer/xstate', stateViewer as unknown as Hooks, true],
];

/** When `debug.disabled` turns on, if it does: while the Activity hides the upload, or in the render revealing it. */
type Disabling = 'never' | 'while hidden' | 'on reveal';

const DISABLINGS: [when: string, disabling: Disabling][] = [
  ['debug stays on', 'never'],
  ['debug.disabled turns on while an Activity hides the upload', 'while hidden'],
  ['debug.disabled turns on in the render that reveals the upload', 'on reveal'],
];

const STRICT_MODES: [name: string, reactStrictMode: boolean][] = [
  ['under StrictMode', true],
  ['without StrictMode', false],
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

/** The done snapshot, then complete: how XState tells an observer the actor finished. */
const DONE = ['next:done:uploaded', 'complete'];

/** How many times the observer heard the done snapshot, and complete. */
const tally = (calls: string[]): { done: number; complete: number } => ({
  done: calls.filter((call) => call === 'next:done:uploaded').length,
  complete: calls.filter((call) => call === 'complete').length,
});

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
  describe.each(DISABLINGS)('%s', (_when, disabling) => {
    /** The markers of the steps between the actor's ending and the reveal, the reveal included. */
    const hideAndReveal = ['[hide]', ...(disabling === 'while hidden' ? ['[debug disabled]'] : []), '[reveal]'];

    describe.each(STRICT_MODES)('%s', (_mode, reactStrictMode) => {
      /**
       * Mounts `Upload` in an Activity, previews `failed`, and ends the actor underneath: the app stops it (the user
       * cancels), or the socket finishes it. Then a tab switch hides the upload, the registry drops the preview, debug
       * is disabled when `disabling` says, and the upload is shown again. Later the component renders for an unrelated
       * reason, and a disabled debug is turned on again. The returned `calls` hold what the observer heard, with a
       * marker before each step.
       */
      async function endThenHideAndReveal(
        stable: boolean,
        ending: 'stop' | 'finish',
      ): Promise<{ calls: string[]; actorRef: UploadActor }> {
        const calls: string[] = [];
        let actorRef: UploadActor | undefined;
        function Upload({ disabled }: { disabled: boolean }) {
          const inline: Observer<UploadSnapshot> = {
            next: (snapshot) => calls.push(`next:${label(snapshot)}`),
            complete: () => calls.push('complete'),
          };
          const [first] = React.useState(inline);
          actorRef = hooks.useActorRef(uploadMachine, { debug: { disabled } } as never, stable ? first : inline);
          return null;
        }
        function App({ mode, disabled }: { mode: 'visible' | 'hidden'; disabled: boolean }) {
          return (
            <Activity mode={mode}>
              <Upload disabled={disabled} />
            </Activity>
          );
        }
        const view = render(<App mode="visible" disabled={false} />, { reactStrictMode });
        await flush();
        if (previews) act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves: ['failed'] }));
        await flush();

        calls.length = 0;
        calls.push(ending === 'stop' ? '[app stops]' : '[finish]');
        act(() => {
          if (ending === 'stop') actorRef!.stop();
          else finishUpload?.();
        });
        await flush();

        calls.push('[hide]');
        view.rerender(<App mode="hidden" disabled={false} />);
        // The registry drops the preview of the instance that unregistered at its next flush.
        await flush();
        await flush();
        expect(registry().getSnapshot().overrides).toEqual({});
        if (disabling === 'while hidden') {
          calls.push('[debug disabled]');
          view.rerender(<App mode="hidden" disabled />);
          await flush();
        }
        calls.push('[reveal]');
        const disabled = disabling !== 'never';
        view.rerender(<App mode="visible" disabled={disabled} />);
        await flush();
        await flush();

        calls.push('[later render]');
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        });
        view.rerender(<App mode="visible" disabled={disabled} />);
        await flush();
        if (disabled) {
          calls.push('[debug on]');
          view.rerender(<App mode="visible" disabled={false} />);
          await flush();
        }
        return { calls, actorRef: actorRef! };
      }

      /** The markers of the steps after the reveal, each followed by what the observer hears in it. */
      const later = (heard: string[]): string[] => [
        '[later render]',
        ...heard,
        ...(disabling === 'never' ? [] : ['[debug on]', ...heard]),
      ];

      test.each(OBSERVERS)(
        '%s given to useActorRef hears complete once, by the reveal, when the app stopped the actor during a preview',
        async (_kind, stable) => {
          const { calls, actorRef } = await endThenHideAndReveal(stable, 'stop');

          // The hook holds complete back until the reveal; @xstate/react tells the observer at the stop.
          expect(calls).toEqual(
            previews
              ? ['[app stops]', ...hideAndReveal, 'complete', ...later([])]
              : ['[app stops]', 'complete', ...hideAndReveal, ...later([])],
          );
          expect(actorRef.getSnapshot().status).toBe('stopped');
        },
      );

      test.each(OBSERVERS)(
        '%s given to useActorRef hears a finished actor’s ending as many times as with @xstate/react',
        async (_kind, stable) => {
          const { calls, actorRef } = await endThenHideAndReveal(stable, 'finish');

          // @xstate/react starts the actor again on the reveal, and once more under StrictMode, which runs the effects
          // again; XState repeats a finished actor's ending each time.
          const restarts = reactStrictMode ? [...DONE, ...DONE] : DONE;
          // It subscribes an inline observer again on each later render, and XState completes it, as the actor is done.
          const resubscribed = stable ? [] : ['complete'];
          const withXStateReact = ['[finish]', ...DONE, ...hideAndReveal, ...restarts, ...later(resubscribed)];
          // The preview hides the ending, and shows the observer the preview again as the real actor moves underneath;
          // the hook delivers the ending on the reveal, before @xstate/react's restarts repeat it.
          const withStateViewer = [
            '[finish]',
            'next:active:failed',
            ...hideAndReveal,
            ...DONE,
            ...restarts,
            ...later(resubscribed),
          ];

          expect(calls).toEqual(previews ? withStateViewer : withXStateReact);
          expect(tally(calls)).toEqual(tally(withXStateReact));
          expect(actorRef.getSnapshot().status).toBe('done');
        },
      );
    });
  });
});
