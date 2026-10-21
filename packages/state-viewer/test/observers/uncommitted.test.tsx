import { act, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, test } from 'vitest';
import { fromCallback, setup, type Observer, type SnapshotFrom } from 'xstate';
import { withDebug } from '../support/anti-slop-b';
import { page } from '../support/app';
import { describeWithActivity, IMPLEMENTATIONS } from '../support/hooks';
import { flush, freshId, preview, release } from '../support/panel';

type Socket = (event: { type: 'FINISH' }) => void;

/**
 * An upload whose invoked socket reports that the upload finished. The test reports through `sockets`, by the
 * machine's version, past the hook's actor: a preview blocks the events the app sends through that.
 * A new machine each call, as Fast Refresh or a machine built from props gives the hook. `version` names the machine
 * in what an observer hears.
 */
function createUploadMachine({ id, version }: { id: string; version: string }, sockets: Map<string, Socket>) {
  return setup({
    actors: {
      socket: fromCallback<{ type: 'FINISH' }>(({ sendBack }) => {
        sockets.set(version, sendBack);

        return () => {
          if (sockets.get(version) === sendBack) sockets.delete(version);
        };
      }),
    },
  }).createMachine({
    id,
    version,
    initial: 'uploading',
    states: {
      uploading: { invoke: { src: 'socket' }, on: { FINISH: 'uploaded' } },
      failed: {},
      uploaded: { type: 'final' },
    },
  });
}

type UploadMachine = ReturnType<typeof createUploadMachine>;

type UploadSnapshot = SnapshotFrom<UploadMachine>;

/** A new observer on every render, as apps usually write it, or one the component keeps with useMemo. */
type Kind = 'inline' | 'stable';

const OBSERVERS: [name: string, kind: Kind][] = [
  ['an inline observer', 'inline'],
  ['a stable observer', 'stable'],
];

/** What the app renders the upload with. `loading` is a view whose data the files list next to it doesn't have yet. */
type AppState = { machine: UploadMachine; disabled: boolean; filter: string; loading: boolean };

/** How the app makes an update: a transition stays pending while the list suspends, a plain update shows the fallback. */
type Update = 'transition' | 'plain update';

/** What the suspended update changes for the hook. */
type Change = 'keeps the machine' | 'a new machine' | 'debug.disabled on' | 'a new observer';

/** What the page shows while the update is suspended. */
type Shows = 'the committed view' | 'the fallback';

/** Renders React throws away: an update that suspends on the files list. The updates that keep the machine are controls. */
const SUSPENDED: [what: string, update: Update, change: Change, shows: Shows][] = [
  ['a suspended transition that keeps the machine (control)', 'transition', 'keeps the machine', 'the committed view'],
  ['a suspended transition with a new machine', 'transition', 'a new machine', 'the committed view'],
  ['a suspended transition that turns debug.disabled on', 'transition', 'debug.disabled on', 'the committed view'],
  ['a suspended plain update that keeps the machine (control)', 'plain update', 'keeps the machine', 'the fallback'],
  ['a suspended plain update with a new machine', 'plain update', 'a new machine', 'the fallback'],
  ['a suspended plain update that turns debug.disabled on', 'plain update', 'debug.disabled on', 'the fallback'],
];

/** Renders after a committed replacement left a stable observer on the replaced actor. */
const AFTER_REPLACEMENT: [what: string, update: Update, change: Change][] = [
  ['a suspended transition that passes the same observer (control)', 'transition', 'keeps the machine'],
  ['a suspended transition that passes a new observer', 'transition', 'a new observer'],
];

const { use } = React;

/** Data that never arrives. */
const never = new Promise<never>(() => {});

/** What an observer hears of a snapshot: its status and value, and the version of the machine it is of. */
const label = (snapshot: UploadSnapshot): string =>
  `${snapshot.status}:${String(snapshot.value)} (${snapshot.machine.version})`;

function observe(calls: string[]): Observer<UploadSnapshot> {
  return {
    next: (snapshot) => calls.push(label(snapshot)),
    complete: () => calls.push('complete'),
  };
}

// The files list suspends with use(), which React 18 doesn't have.
describeWithActivity('a render React throws away', () => {
  describe.each(IMPLEMENTATIONS)('like @xstate/react, with %s', (_, hooks, previews) => {
    /**
     * Mounts the upload in a Suspense boundary next to the files list, with useActorRef given an inline observer, or a
     * stable one that the component makes again only when the filter changes. The observer logs what it hears to
     * `calls`. `calls` starts empty after the mount, and each step pushes a marker before it acts.
     */
    async function mountUpload(kind: Kind) {
      const calls: string[] = [];
      const sockets = new Map<string, Socket>();
      const id = freshId('upload');

      let committed: AppState = {
        machine: createUploadMachine({ id, version: 'old' }, sockets),
        disabled: false,
        filter: 'all',
        loading: false,
      };

      let setState: React.Dispatch<React.SetStateAction<AppState>> = () => {};

      function Upload({ machine, disabled, filter }: Omit<AppState, 'loading'>) {
        const inline = observe(calls);
        // The component makes its stable observer again when the filter it reports under changes.
        const stable = React.useMemo(() => observe(calls), [filter]);
        hooks.useActorRef(machine, withDebug({ disabled }), kind === 'stable' ? stable : inline);

        return null;
      }

      function Files({ loading }: { loading: boolean }) {
        if (loading) use(never);

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

      render(page(<App />));
      await flush();
      calls.length = 0;

      const step = async (marker: string, run: () => void | Promise<void>): Promise<void> => {
        calls.push(marker);
        await act(async () => {
          await run();
        });
        await flush();
      };

      const patch = (change: Change): Partial<AppState> => {
        switch (change) {
          case 'keeps the machine':
            return {};
          case 'a new machine':
            return { machine: createUploadMachine({ id, version: 'thrown away' }, sockets) };
          case 'debug.disabled on':
            return { disabled: true };
          case 'a new observer':
            return { filter: 'mine' };
        }
      };

      return {
        calls,
        /** The socket of the committed upload reports it finished: the real actor takes it, also while a preview shows. */
        finish: () =>
          step('[finish]', () => {
            const send = sockets.get(String(committed.machine.version));

            if (!send) throw new Error(`No socket runs for the ${committed.machine.version} upload.`);
            send({ type: 'FINISH' });
          }),
        preview: () =>
          step('[preview failed]', async () => {
            if (previews) await preview(id, ['failed']);
          }),
        release: () =>
          step('[release]', async () => {
            if (previews) await release(id);
          }),
        /** Fast Refresh renders the upload with a new machine, which commits: @xstate/react replaces the actor. */
        replace: () =>
          step('[replace]', () => {
            committed = { ...committed, machine: createUploadMachine({ id, version: 'new' }, sockets) };
            setState(committed);
          }),
        /**
         * Makes `change` in an update that also moves the files list to data it doesn't have, so React doesn't commit
         * it. Returns what the page shows meanwhile.
         */
        suspend: async (update: Update, change: Change): Promise<Shows> => {
          calls.push(`[${update}]`);
          const apply = (): void => setState((previous) => ({ ...previous, ...patch(change), loading: true }));
          await act(async () => (update === 'transition' ? React.startTransition(apply) : apply()));
          await flush();

          return screen.queryByText('loading') === null ? 'the committed view' : 'the fallback';
        },
        /** The user goes back to the committed view before the new one's data arrives: React abandons the transition. */
        back: () => step('[back]', () => React.startTransition(() => setState(committed))),
      };
    }

    describe.each(OBSERVERS)('%s given to useActorRef', (_, kind) => {
      describe('while the upload runs', () => {
        test.each(SUSPENDED)(
          "%s: it follows the committed actor's previews and real updates",
          async (_, update, change, shows) => {
            const upload = await mountUpload(kind);

            const shown = await upload.suspend(update, change);
            await upload.preview();
            await upload.release();
            await upload.finish();
            expect({ shown, calls: upload.calls }).toEqual({
              shown: shows,
              calls: previews
                ? [
                    `[${update}]`,
                    '[preview failed]',
                    'active:failed (old)',
                    '[release]',
                    'active:uploading (old)',
                    '[finish]',
                    'done:uploaded (old)',
                    'complete',
                  ]
                : [`[${update}]`, '[preview failed]', '[release]', '[finish]', 'done:uploaded (old)', 'complete'],
            });
          },
        );
      });

      describe('after the upload finished', () => {
        test.each(SUSPENDED)('%s: it hears no preview and no done snapshot again', async (_, update, change, shows) => {
          const upload = await mountUpload(kind);

          await upload.finish();
          const shown = await upload.suspend(update, change);
          await upload.preview();
          await upload.release();
          expect({ shown, calls: upload.calls }).toEqual({
            shown: shows,
            calls: ['[finish]', 'done:uploaded (old)', 'complete', `[${update}]`, '[preview failed]', '[release]'],
          });
        });

        test.each([
          ["with a preview while it's pending", true],
          ["with no preview while it's pending", false],
        ])(
          'a transition with a new machine, abandoned %s: no preview and no done snapshot again',
          async (_, previewWhilePending) => {
            const upload = await mountUpload(kind);

            await upload.finish();
            await upload.suspend('transition', 'a new machine');

            if (previewWhilePending) {
              await upload.preview();
              await upload.release();
            }

            await upload.back();
            await upload.preview();
            await upload.release();
            expect(upload.calls).toEqual([
              '[finish]',
              'done:uploaded (old)',
              'complete',
              '[transition]',
              ...(previewWhilePending ? ['[preview failed]', '[release]'] : []),
              '[back]',
              '[preview failed]',
              '[release]',
            ]);
          },
        );
      });

      describe('an ending a preview holds back', () => {
        test.each(SUSPENDED)(
          '%s, then the upload finishes during a preview: it hears the ending once, at the release',
          async (_, update, change, shows) => {
            const upload = await mountUpload(kind);

            const shown = await upload.suspend(update, change);
            await upload.preview();
            await upload.finish();
            await upload.release();
            await upload.preview();
            await upload.release();
            expect({ shown, calls: upload.calls }).toEqual({
              shown: shows,
              calls: previews
                ? [
                    `[${update}]`,
                    '[preview failed]',
                    'active:failed (old)',
                    // The preview of the finished upload loses its invoked socket.
                    '[finish]',
                    'active:failed (old)',
                    '[release]',
                    'done:uploaded (old)',
                    'complete',
                    '[preview failed]',
                    '[release]',
                  ]
                : [
                    `[${update}]`,
                    '[preview failed]',
                    '[finish]',
                    'done:uploaded (old)',
                    'complete',
                    '[release]',
                    '[preview failed]',
                    '[release]',
                  ],
            });
          },
        );

        test.each(SUSPENDED)(
          'the upload finishes during a preview, then %s: it hears the ending once, at the release',
          async (_, update, change, shows) => {
            const upload = await mountUpload(kind);

            await upload.preview();
            await upload.finish();
            const shown = await upload.suspend(update, change);
            await upload.release();
            await upload.preview();
            await upload.release();
            expect({ shown, calls: upload.calls }).toEqual({
              shown: shows,
              calls: previews
                ? [
                    '[preview failed]',
                    'active:failed (old)',
                    '[finish]',
                    'active:failed (old)',
                    `[${update}]`,
                    '[release]',
                    'done:uploaded (old)',
                    'complete',
                    '[preview failed]',
                    '[release]',
                  ]
                : [
                    '[preview failed]',
                    '[finish]',
                    'done:uploaded (old)',
                    'complete',
                    `[${update}]`,
                    '[release]',
                    '[preview failed]',
                    '[release]',
                  ],
            });
          },
        );
      });
    });

    describe('a stable observer that a committed replacement left on the replaced actor', () => {
      test.each(AFTER_REPLACEMENT)(
        "%s: it gets none of the new actor's previews or real updates",
        async (_, update, change) => {
          const upload = await mountUpload('stable');

          await upload.replace();
          await upload.suspend(update, change);
          await upload.preview();
          await upload.release();
          await upload.finish();
          expect(upload.calls).toEqual(['[replace]', `[${update}]`, '[preview failed]', '[release]', '[finish]']);
        },
      );

      test("a suspended transition that passes a new observer, then abandoned: none of the new actor's previews or updates", async () => {
        const upload = await mountUpload('stable');

        await upload.replace();
        await upload.suspend('transition', 'a new observer');
        await upload.back();
        await upload.preview();
        await upload.release();
        await upload.finish();
        expect(upload.calls).toEqual([
          '[replace]',
          '[transition]',
          '[back]',
          '[preview failed]',
          '[release]',
          '[finish]',
        ]);
      });

      test.each(AFTER_REPLACEMENT)(
        'the upload finished, then %s: it hears no preview and no done snapshot again',
        async (_, update, change) => {
          const upload = await mountUpload('stable');

          await upload.finish();
          await upload.replace();
          await upload.suspend(update, change);
          await upload.preview();
          await upload.release();
          expect(upload.calls).toEqual([
            '[finish]',
            'done:uploaded (old)',
            'complete',
            '[replace]',
            `[${update}]`,
            '[preview failed]',
            '[release]',
          ]);
        },
      );
    });
  });
});
