// Which actor and binding the observer given to useActorRef follows is decided in the commit phase (spec §10.2,
// "Lifecycle"), because React also renders the hook in renders it throws away. Here the upload sits in a Suspense
// boundary next to a list of files, and an update that makes the list load data it doesn't have yet suspends: a
// transition stays pending, the committed UI staying on screen and interactive, and a plain update shows the fallback,
// which hides the upload while its actor keeps running and the overlay keeps previewing it. The user can also abandon
// the transition by going back. The render React throws away can give the hook a machine with a new config (built
// from an endpoint prop, or what Fast Refresh gives), from which @xstate/react creates a replacement actor during
// render that never starts; it can turn `debug.disabled` on; or it can pass a new observer, which @xstate/react
// subscribes only in an effect, so never. None of it reaches the observers of the committed render: @xstate/react
// keeps them on the committed actor, and state-viewer, which shows an observer the previews of the actor @xstate/react
// subscribed it to, keeps them there too:
// - They follow the committed actor: its previews, its real snapshot on the release, and its real updates.
// - Once they heard the upload finish, they hear no preview and no done snapshot again (spec §10.2, "Observers and the
//   actor's ending"), as @xstate/react tells them nothing more.
// - An ending a preview held back reaches them once, at the release (R13): the done snapshot, then complete.
// - A stable observer that a committed replacement left on the replaced actor, which tells it nothing more, gets none
//   of the new actor's previews or real updates, while a render that passes a new observer is pending and after it's
//   abandoned: @xstate/react subscribes an observer to the new actor only when an update that passes it commits.
// Updates that keep the machine, or pass the same observer, are controls: no new actor, no new observer.

import { act, render, screen } from '@testing-library/react';
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
type ObserverKind = 'inline' | 'stable';

/**
 * What the app renders the upload with. `loading` is a view whose data the files list next to the upload doesn't have
 * yet: the list suspends.
 */
type AppState = { machine: UploadMachine; disabled: boolean; filter: string; loading: boolean };
type Change = () => Partial<AppState>;
type Update = 'transition' | 'plain update';

const IMPLEMENTATIONS: [name: string, hooks: Hooks, previews: boolean][] = [
  ['@xstate/react (control)', xstateReact, false],
  ['state-viewer/xstate', stateViewer as unknown as Hooks, true],
];

/** A new observer on every render, as apps usually write it, or one the component keeps with useMemo. */
const OBSERVERS: [name: string, kind: ObserverKind][] = [
  ['an inline observer', 'inline'],
  ['a stable observer', 'stable'],
];

const keepMachine: Change = () => ({});
const newMachine: Change = () => ({ machine: createUploadMachine('/v2/upload') });
const disableDebug: Change = () => ({ disabled: true });

/**
 * Renders React throws away: an update that suspends on the files list, and what it changes for the hook. No update,
 * and the updates that keep the machine, are the controls.
 */
const SUSPENDED: [what: string, update: Update | undefined, change: Change][] = [
  ['no update (control)', undefined, keepMachine],
  ['a suspended transition that keeps the machine (control)', 'transition', keepMachine],
  ['a suspended transition with a new machine', 'transition', newMachine],
  ['a suspended transition that turns debug.disabled on', 'transition', disableDebug],
  ['a suspended plain update that keeps the machine (control)', 'plain update', keepMachine],
  ['a suspended plain update with a new machine', 'plain update', newMachine],
  ['a suspended plain update that turns debug.disabled on', 'plain update', disableDebug],
];

/** Renders after a committed replacement left a stable observer on the replaced actor. */
const AFTER_REPLACEMENT: [what: string, update: Update | undefined, change: Change][] = [
  ['no update (control)', undefined, keepMachine],
  ['a suspended transition that passes the same observer (control)', 'transition', keepMachine],
  // The component makes its observer again when the filter it reports under changes.
  ['a suspended transition that passes a new observer', 'transition', () => ({ filter: 'mine' })],
];

/** Data that never arrives. */
const never = new Promise<never>(() => {});

const label = (snapshot: UploadSnapshot): string => `${snapshot.status}:${String(snapshot.value)}`;

/** What the observer heard of how the actor ended: the done snapshots and completes. */
const endingIn = (calls: string[]): string[] =>
  calls.filter((call) => call === 'done:uploaded' || call === 'complete');

/** The marker a suspended update leaves in the calls, if there is one. */
const marked = (update: Update | undefined): string[] => (update ? [`[${update}]`] : []);

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
   * Mounts the upload in a Suspense boundary next to the files list, with useActorRef given an inline observer, or a
   * stable one that the component makes again only when the filter changes. The observer logs each snapshot to
   * `calls` as `status:value`, and complete as `complete`. `calls` starts empty after the mount, and each step pushes
   * a marker before it acts.
   */
  async function mountUpload(kind: ObserverKind) {
    const calls: string[] = [];
    // Every actor the hook returned, in renders React committed or threw away, and the committed render's.
    const rendered = new Set<UploadActor>();
    let committedActor: UploadActor | undefined;
    let committed: AppState = { machine: createUploadMachine(), disabled: false, filter: 'all', loading: false };
    let setState: React.Dispatch<React.SetStateAction<AppState>> = () => {};

    function Upload({ machine, disabled, filter }: Omit<AppState, 'loading'>) {
      const inline: Observer<UploadSnapshot> = {
        next: (snapshot) => calls.push(label(snapshot)),
        complete: () => calls.push('complete'),
      };
      const stable = React.useMemo(() => inline, [filter]);
      const observer = kind === 'stable' ? stable : inline;
      const actorRef = hooks.useActorRef(machine, { debug: { disabled } } as never, observer);
      rendered.add(actorRef);
      React.useLayoutEffect(() => {
        committedActor = actorRef;
      });
      return null;
    }
    function Files({ loading }: { loading: boolean }) {
      if (loading) React.use(never);
      return <p>files</p>;
    }
    function App() {
      const [state, set] = React.useState(committed);
      setState = set;
      return (
        <React.Suspense fallback={<p>loading</p>}>
          <Upload machine={state.machine} disabled={state.disabled} filter={state.filter} />
          <Files loading={state.loading} />
        </React.Suspense>
      );
    }
    render(<App />);
    await flush();
    // Under StrictMode @xstate/react starts the actor twice, and the observer hears each start.
    expect(calls.splice(0)).toEqual(['active:uploading', 'active:uploading']);

    return {
      calls,
      /** The socket reports the upload finished: the real actor takes it, also while a preview shows. */
      finish: async (): Promise<void> => {
        calls.push('[finish]');
        act(() => finishUpload!());
        await flush();
      },
      /** Previews `failed` on the upload, as someone in the overlay would; only the adapter registers it. */
      preview: async (): Promise<void> => {
        calls.push('[preview]');
        if (previews) act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves: ['failed'] }));
        await flush();
      },
      /** Closes the overlay, ending the preview. */
      release: async (): Promise<void> => {
        calls.push('[release]');
        if (previews) act(() => registry().release());
        await flush();
      },
      /** Fast Refresh renders the upload with a new machine, which commits: @xstate/react replaces the actor. */
      replace: async (): Promise<void> => {
        calls.push('[replace]');
        const replaced = committedActor;
        committed = { ...committed, machine: createUploadMachine() };
        act(() => setState(committed));
        await flush();
        expect(committedActor).not.toBe(replaced);
      },
      /**
       * Makes `change` in an update that also moves the files list to data it doesn't have, so React doesn't commit
       * it: a transition stays pending, a plain update shows the fallback. Does nothing without an update.
       */
      suspend: async (update: Update | undefined, change: Partial<AppState>): Promise<void> => {
        if (!update) return;
        calls.push(`[${update}]`);
        const actor = committedActor;
        const actors = rendered.size;
        const handle = previews ? onlyHandle('upload') : undefined;
        const apply = (): void => setState((previous) => ({ ...previous, ...change, loading: true }));
        await act(async () => (update === 'transition' ? React.startTransition(apply) : apply()));
        await flush();

        // A transition keeps the committed UI on screen; a plain update shows the fallback.
        expect(screen.queryByText('loading') === null).toBe(update === 'transition');
        // The committed actor carries on, and the overlay still lists and previews its registration. A new machine
        // makes @xstate/react create a replacement actor in the render React throws away.
        expect(committedActor).toBe(actor);
        if (handle) expect(onlyHandle('upload')).toBe(handle);
        if (change.machine) expect(rendered.size).toBeGreaterThan(actors);
      },
      /** The user goes back to the committed view before the new one's data arrives: React abandons the transition. */
      back: async (): Promise<void> => {
        calls.push('[back]');
        const actor = committedActor;
        await act(async () => React.startTransition(() => setState(committed)));
        await flush();
        expect(screen.queryByText('loading')).toBeNull();
        expect(committedActor).toBe(actor);
      },
    };
  }

  describe.each(OBSERVERS)('%s given to useActorRef', (_observer, kind) => {
    describe('while the upload runs', () => {
      test.each(SUSPENDED)(
        '%s: it follows the committed actor’s previews and real updates',
        async (_what, update, change) => {
          const upload = await mountUpload(kind);
          await upload.suspend(update, change());
          await upload.preview();
          await upload.release();
          await upload.finish();

          expect(upload.calls).toEqual(
            previews
              ? [
                  ...marked(update),
                  '[preview]', 'active:failed',
                  '[release]', 'active:uploading',
                  '[finish]', 'done:uploaded', 'complete',
                ]
              : [...marked(update), '[preview]', '[release]', '[finish]', 'done:uploaded', 'complete'],
          );
        },
      );
    });

    describe('after the upload finished', () => {
      test.each(SUSPENDED)('%s: it hears no preview and no done snapshot again', async (_what, update, change) => {
        const upload = await mountUpload(kind);
        await upload.finish();
        await upload.suspend(update, change());
        await upload.preview();
        await upload.release();

        expect(upload.calls).toEqual([
          '[finish]', 'done:uploaded', 'complete',
          ...marked(update),
          '[preview]', '[release]',
        ]);
      });

      test.each([
        ['with a preview while it’s pending', true],
        ['with no preview while it’s pending', false],
      ])(
        'a transition with a new machine, abandoned %s: no preview and no done snapshot again',
        async (_what, previewWhilePending) => {
          const upload = await mountUpload(kind);
          await upload.finish();
          await upload.suspend('transition', newMachine());
          if (previewWhilePending) {
            await upload.preview();
            await upload.release();
          }
          await upload.back();
          await upload.preview();
          await upload.release();

          expect(upload.calls).toEqual([
            '[finish]', 'done:uploaded', 'complete',
            '[transition]',
            ...(previewWhilePending ? ['[preview]', '[release]'] : []),
            '[back]',
            '[preview]', '[release]',
          ]);
        },
      );
    });

    describe('an ending a preview holds back (R13)', () => {
      test.each(SUSPENDED)(
        '%s, then the upload finishes during a preview: it hears the ending once, at the release',
        async (_what, update, change) => {
          const upload = await mountUpload(kind);
          await upload.suspend(update, change());
          await upload.preview();
          await upload.finish();
          await upload.release();
          // It has been told how the actor ended: a later preview shows it nothing.
          await upload.preview();
          await upload.release();

          const { calls } = upload;
          expect(calls).toEqual(
            previews
              ? [
                  ...marked(update),
                  '[preview]', 'active:failed',
                  '[finish]', 'active:failed',
                  '[release]', 'done:uploaded', 'complete',
                  '[preview]', '[release]',
                ]
              : [
                  ...marked(update),
                  '[preview]',
                  '[finish]', 'done:uploaded', 'complete',
                  '[release]', '[preview]', '[release]',
                ],
          );
          expect(endingIn(calls)).toEqual(['done:uploaded', 'complete']);
          if (previews) expect(endingIn(calls.slice(0, calls.indexOf('[release]')))).toEqual([]);
        },
      );

      test.each(SUSPENDED)(
        'the upload finishes during a preview, then %s: it hears the ending once, at the release',
        async (_what, update, change) => {
          const upload = await mountUpload(kind);
          await upload.preview();
          await upload.finish();
          await upload.suspend(update, change());
          await upload.release();
          await upload.preview();
          await upload.release();

          const { calls } = upload;
          expect(calls).toEqual(
            previews
              ? [
                  '[preview]', 'active:failed',
                  '[finish]', 'active:failed',
                  ...marked(update),
                  '[release]', 'done:uploaded', 'complete',
                  '[preview]', '[release]',
                ]
              : [
                  '[preview]',
                  '[finish]', 'done:uploaded', 'complete',
                  ...marked(update),
                  '[release]', '[preview]', '[release]',
                ],
          );
          expect(endingIn(calls)).toEqual(['done:uploaded', 'complete']);
          if (previews) expect(endingIn(calls.slice(0, calls.indexOf('[release]')))).toEqual([]);
        },
      );
    });
  });

  describe('a stable observer that a committed replacement left on the replaced actor', () => {
    test.each(AFTER_REPLACEMENT)(
      '%s: it gets none of the new actor’s previews or real updates',
      async (_what, update, change) => {
        const upload = await mountUpload('stable');
        await upload.replace();
        await upload.suspend(update, change());
        await upload.preview();
        await upload.release();
        await upload.finish();

        expect(upload.calls).toEqual(['[replace]', ...marked(update), '[preview]', '[release]', '[finish]']);
      },
    );

    test(
      'a suspended transition that passes a new observer, then abandoned: none of the new actor’s previews or updates',
      async () => {
        const upload = await mountUpload('stable');
        await upload.replace();
        await upload.suspend('transition', { filter: 'mine' });
        await upload.back();
        await upload.preview();
        await upload.release();
        await upload.finish();

        expect(upload.calls).toEqual(['[replace]', '[transition]', '[back]', '[preview]', '[release]', '[finish]']);
      },
    );

    test.each(AFTER_REPLACEMENT)(
      'the upload finished, then %s: it hears no preview and no done snapshot again',
      async (_what, update, change) => {
        const upload = await mountUpload('stable');
        await upload.finish();
        await upload.replace();
        await upload.suspend(update, change());
        await upload.preview();
        await upload.release();

        expect(upload.calls).toEqual([
          '[finish]', 'done:uploaded', 'complete',
          '[replace]',
          ...marked(update),
          '[preview]', '[release]',
        ]);
      },
    );
  });
});
