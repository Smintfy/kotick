// When the machine a hook gets has a new config (Fast Refresh re-evaluates the machine's module, or the component
// builds its machine from a prop), @xstate/react replaces the hook's actor: it creates a new actor from the old one's
// persisted snapshot, stops the old one and starts the new one. If the old actor ended while a preview showed (it
// finished, or the app stopped it: stop() isn't an event, so the preview doesn't block it), the hook holds the ending
// back until no preview hides the real snapshot, and the
// replacement doesn't cancel that: the ending is still owed to the observer given to useActorRef, which hears it once
// the preview ends, before anything about the new actor. With @xstate/react, which has no previews, the observer hears
// the ending when the actor ends, and state-viewer delivers the same ending, later:
// - On the release, the done snapshot and complete when the actor finished, complete when the app stopped it. An
//   inline observer, which @xstate/react subscribes to the new actor, also hears the ending again when @xstate/react
//   restarts that actor from a done snapshot (XState repeats a finished actor's ending, never a stopped one's), held
//   back the same way; meanwhile it sees the new actor's previews. A stable observer stays with the replaced actor
//   and hears its ending once. Either way a later preview of the machine shows the observer nothing: it has been told
//   how the actor ended.
// - When debug.disabled turns on after the replacement while the preview is on, at once: the observer leaves the
//   preview as on a release.
// - When an Activity hides the component after the replacement and the preview is released while it's hidden, on the
//   reveal, when the hook connects again: @xstate/react restarts the stopped actor, which tells its observers nothing.
// - When one release settles several owed endings (a finished actor replaced twice) and the observer's complete
//   previews the machine and releases it again from inside the callback, each ending is heard once, in order.
// In every case the observer hears as many done snapshots and completes as with @xstate/react.

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fromCallback, setup, type Actor, type Observer, type SnapshotFrom } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

/** What the invoked socket uses to tell the machine the upload finished, past the proxy (previews block sends). */
let finishUpload: (() => void) | undefined;

/** A fresh machine from a fresh config each call: what Fast Refresh, or a machine built from props, gives the hook. */
function createUploadMachine(endpoint = '/upload') {
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
type UploadActor = Actor<UploadMachine>;
type UploadSnapshot = SnapshotFrom<UploadMachine>;
type Hooks = Pick<typeof xstateReact, 'useActorRef'>;
type Mode = 'visible' | 'hidden';

const IMPLEMENTATIONS: [name: string, hooks: Hooks, previews: boolean][] = [
  ['@xstate/react (control)', xstateReact, false],
  ['state-viewer/xstate', stateViewer as unknown as Hooks, true],
];

/** A new observer on every render, as apps usually write it, or the first render's throughout. */
const OBSERVERS: [name: string, kind: 'inline' | 'stable'][] = [
  ['an inline observer', 'inline'],
  ['a stable observer', 'stable'],
];

/** What gives the hook a machine with a new config: the same endpoint after an edit, or a new one. */
const REPLACEMENTS: [what: string, endpoint: string][] = [
  ['Fast Refresh of the machine module', '/upload'],
  ['a machine built from an endpoint prop', '/v2/upload'],
];

type Ending = 'finish' | 'stop';

const ENDINGS: [how: string, ending: Ending][] = [
  ['finishes', 'finish'],
  ['is stopped by the app', 'stop'],
];

/**
 * What the observer hears when the old actor ends during a preview of `failed`, a new machine replaces it, the preview
 * is released, and the machine is previewed and released again, under StrictMode. With state-viewer the finishing
 * actor's preview loses the invoked socket (`next:active:failed`), and an inline observer, subscribed to the new actor,
 * sees the new actor's preview when @xstate/react's restart sends it a snapshot.
 */
const HEARD: Record<Ending, Record<'inline' | 'stable', { control: string[]; stateViewer: string[] }>> = {
  finish: {
    inline: {
      control: [
        '[finish]',
        'next:done:uploaded',
        'complete',
        '[replace]',
        'next:done:uploaded',
        'complete',
        '[release]',
        '[preview again]',
      ],
      stateViewer: [
        '[finish]',
        'next:active:failed',
        '[replace]',
        'next:active:failed',
        '[release]',
        'next:done:uploaded',
        'complete',
        'next:done:uploaded',
        'complete',
        '[preview again]',
      ],
    },
    stable: {
      control: ['[finish]', 'next:done:uploaded', 'complete', '[replace]', '[release]', '[preview again]'],
      stateViewer: [
        '[finish]',
        'next:active:failed',
        '[replace]',
        '[release]',
        'next:done:uploaded',
        'complete',
        '[preview again]',
      ],
    },
  },
  stop: {
    inline: {
      control: ['[stop]', 'complete', '[replace]', '[release]', '[preview again]'],
      stateViewer: ['[stop]', '[replace]', '[release]', 'complete', '[preview again]'],
    },
    stable: {
      control: ['[stop]', 'complete', '[replace]', '[release]', '[preview again]'],
      stateViewer: ['[stop]', '[replace]', '[release]', 'complete', '[preview again]'],
    },
  },
};

const Activity = (
  React as unknown as { Activity: React.ComponentType<{ mode: Mode; children: React.ReactNode }> }
).Activity;

const label = (snapshot: { status: string; value: unknown }): string => `${snapshot.status}:${String(snapshot.value)}`;

/** What the observer heard of how an actor ended: the done snapshots and completes. */
const endingIn = (calls: string[]): string[] =>
  calls.filter((call) => call === 'complete' || call === 'next:done:uploaded');

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
  async function preview(leaves: string[]): Promise<void> {
    if (previews) act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves }));
    await flush();
  }

  /** Closes the overlay, ending the preview. */
  async function release(): Promise<void> {
    if (previews) act(() => registry().release());
    await flush();
  }

  type Props = { machine: UploadMachine; mode: Mode; disabled: boolean };

  /**
   * Mounts the upload in an Activity, with useActorRef given an observer that logs each snapshot to `calls` as
   * `next:status:value`, and complete as `complete`, then runs `onComplete`. `update()` renders the app again with new
   * props: a new machine, the Activity's mode, or `debug.disabled`.
   */
  async function mount(calls: string[], kind: 'inline' | 'stable', onComplete?: () => void) {
    let actorRef: UploadActor | undefined;
    function Upload({ machine, disabled }: Pick<Props, 'machine' | 'disabled'>) {
      const inline: Observer<UploadSnapshot> = {
        next: (snapshot) => calls.push(`next:${label(snapshot)}`),
        complete: () => {
          calls.push('complete');
          onComplete?.();
        },
      };
      const [first] = React.useState(inline);
      actorRef = hooks.useActorRef(machine, { debug: { disabled } } as never, kind === 'stable' ? first : inline);
      return null;
    }
    function App({ machine, mode, disabled }: Props) {
      return (
        <Activity mode={mode}>
          <Upload machine={machine} disabled={disabled} />
        </Activity>
      );
    }
    const props: Props = { machine: createUploadMachine(), mode: 'visible', disabled: false };
    const view = render(<App {...props} />);
    await flush();
    return {
      actor: (): UploadActor => actorRef!,
      update: async (patch: Partial<Props>): Promise<void> => {
        Object.assign(props, patch);
        view.rerender(<App {...props} />);
        await flush();
      },
    };
  }

  /**
   * Previews `failed`, then the actor ends underneath (the socket reports the upload finished, which the real actor
   * takes while the preview shows, or the user cancels), and a machine with a new config at `endpoint` replaces it.
   * `calls` holds only what came after the preview started, with a marker before each step.
   */
  async function endThenReplace(
    calls: string[],
    upload: Awaited<ReturnType<typeof mount>>,
    ending: Ending,
    endpoint: string,
  ): Promise<void> {
    await preview(['failed']);
    calls.length = 0;
    calls.push(`[${ending}]`);
    act(() => {
      if (ending === 'finish') finishUpload!();
      else upload.actor().stop();
    });
    await flush();
    calls.push('[replace]');
    const replaced = upload.actor();
    await upload.update({ machine: createUploadMachine(endpoint) });
    expect(upload.actor()).not.toBe(replaced);
  }

  describe.each(OBSERVERS)('%s given to useActorRef', (_observer, kind) => {
    describe.each(REPLACEMENTS)('%s replaces the actor', (_replacement, endpoint) => {
      test.each(ENDINGS)(
        'the old actor %s during a preview: the observer hears it after the release, and no later preview',
        async (_how, ending) => {
          const calls: string[] = [];
          const upload = await mount(calls, kind);
          await endThenReplace(calls, upload, ending, endpoint);
          calls.push('[release]');
          await release();
          // The observer has been told how the actor ended: a later preview shows it nothing.
          calls.push('[preview again]');
          await preview(['uploading']);
          await release();

          const heard = HEARD[ending][kind];
          expect(calls).toEqual(previews ? heard.stateViewer : heard.control);
          // As many done snapshots and completes as with @xstate/react, and none of them while the preview hides them.
          expect(endingIn(calls)).toEqual(endingIn(heard.control));
          if (previews) expect(endingIn(calls.slice(0, calls.indexOf('[release]')))).toEqual([]);
        },
      );
    });

    describe('the app stops the actor during a preview and a new machine replaces it', () => {
      test('debug.disabled turning on while the preview is on tells the observer at once', async () => {
        const calls: string[] = [];
        const upload = await mount(calls, kind);
        await endThenReplace(calls, upload, 'stop', '/v2/upload');
        calls.push('[disable]');
        await upload.update({ disabled: true });
        // Closing the overlay afterwards tells the observer nothing more.
        calls.push('[release]');
        await release();

        expect(calls).toEqual(
          previews
            ? ['[stop]', '[replace]', '[disable]', 'complete', '[release]']
            : ['[stop]', 'complete', '[replace]', '[disable]', '[release]'],
        );
      });

      test('a release while an Activity hides the component reaches the observer on the reveal', async () => {
        const calls: string[] = [];
        const upload = await mount(calls, kind);
        await endThenReplace(calls, upload, 'stop', '/v2/upload');
        calls.push('[hide]');
        await upload.update({ mode: 'hidden' });
        calls.push('[release]');
        await release();
        expect(registry().getSnapshot().overrides).toEqual({});
        calls.push('[reveal]');
        await upload.update({ mode: 'visible' });

        expect(calls).toEqual(
          previews
            ? ['[stop]', '[replace]', '[hide]', '[release]', '[reveal]', 'complete']
            : ['[stop]', 'complete', '[replace]', '[hide]', '[release]', '[reveal]'],
        );
      });
    });
  });

  test('an inline observer whose complete previews and releases hears each owed ending once, in order', async () => {
    const calls: string[] = [];
    let reentered = false;
    // The first complete previews the machine and closes the overlay again, from inside the callback.
    const upload = await mount(calls, 'inline', () => {
      if (reentered) return;
      reentered = true;
      calls.push('[preview from complete]');
      if (previews) registry().preview(keyOf(onlyHandle('upload')), { leaves: ['failed'] });
      calls.push('[release from complete]');
      if (previews) registry().release();
    });
    // Two replacements during one preview: the old actor's finish, then each restart's repeat of it.
    await endThenReplace(calls, upload, 'finish', '/v2/upload');
    calls.push('[replace again]');
    await upload.update({ machine: createUploadMachine('/v3/upload') });
    calls.push('[release]');
    await release();
    await flush();

    const control = [
      '[finish]',
      'next:done:uploaded',
      'complete',
      '[preview from complete]',
      '[release from complete]',
      '[replace]',
      'next:done:uploaded',
      'complete',
      '[replace again]',
      'next:done:uploaded',
      'complete',
      '[release]',
    ];
    expect(calls).toEqual(
      previews
        ? [
            '[finish]',
            'next:active:failed',
            '[replace]',
            'next:active:failed',
            '[replace again]',
            'next:active:failed',
            '[release]',
            'next:done:uploaded',
            'complete',
            '[preview from complete]',
            'next:active:failed',
            '[release from complete]',
            'next:done:uploaded',
            'complete',
            'next:done:uploaded',
            'complete',
          ]
        : control,
    );
    expect(endingIn(calls)).toEqual(endingIn(control));
    if (previews) expect(endingIn(calls.slice(0, calls.indexOf('[release]')))).toEqual([]);
  });
});
