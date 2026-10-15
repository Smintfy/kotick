import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, test } from 'vitest';
import { fromCallback, setup, type Actor, type Observer, type SnapshotFrom } from 'xstate';
import { page } from '../support/app';
import { uncaught } from '../support/console';
import { describeWithActivity, IMPLEMENTATIONS } from '../support/hooks';
import { clickLeaf, flush, freshId, header, preview, release } from '../support/panel';

type SocketEvent = { type: 'FINISH' | 'PAUSE' | 'BREAK' };
type Socket = (event: SocketEvent) => void;

/** What Fast Refresh changed in the machine's states. */
type Edit = 'without failed' | 'with retrying';

/**
 * An upload whose invoked socket reports what the server says. The test reports through `sockets`, by the machine's
 * version, past the hook's actor: a preview blocks the events the app sends through that.
 * A new machine each call, as Fast Refresh or a machine built from props gives the hook. `version` names the machine
 * in what an observer hears.
 */
function createUploadMachine(
  { id, version, edit }: { id: string; version: string; edit?: Edit },
  sockets: Map<string, Socket>,
) {
  return setup({
    actors: {
      socket: fromCallback<SocketEvent>(({ sendBack }) => {
        sockets.set(version, sendBack);
        return () => {
          if (sockets.get(version) === sendBack) sockets.delete(version);
        };
      }),
    },
    actions: {
      crash: () => {
        throw new Error('socket closed');
      },
    },
  }).createMachine({
    id,
    version,
    initial: 'uploading',
    states: {
      uploading: {
        invoke: { src: 'socket' },
        on: {
          FINISH: 'uploaded',
          PAUSE: 'paused',
          CANCEL: 'cancelled',
          BREAK: { actions: 'crash' },
        },
      },
      paused: {},
      ...(edit === 'without failed' ? {} : { failed: {} }),
      ...(edit === 'with retrying' ? { retrying: {} } : {}),
      uploaded: { type: 'final' },
      cancelled: { type: 'final' },
    },
  });
}

type UploadMachine = ReturnType<typeof createUploadMachine>;
type UploadActor = Actor<UploadMachine>;
type UploadSnapshot = SnapshotFrom<UploadMachine>;
type Mode = 'visible' | 'hidden';

/** A new observer on every render, as apps usually write it, or the first render's throughout. */
type Kind = 'inline' | 'stable';

const OBSERVERS: [name: string, kind: Kind][] = [
  ['an inline observer', 'inline'],
  ['a stable observer', 'stable'],
];

const Activity = (
  React as unknown as {
    Activity: React.ComponentType<{ mode: Mode; children: React.ReactNode }>;
  }
).Activity;

/** What an observer hears of a snapshot: its status and value, and the version of the machine it is of. */
const label = (snapshot: UploadSnapshot): string =>
  `${snapshot.status}:${String(snapshot.value)} (${snapshot.machine.version})`;

/** An observer that logs each call: a snapshot as `status:value (version)`, an error as `error:message`. */
function observe(calls: string[]): Observer<UploadSnapshot> {
  return {
    next: (snapshot) => calls.push(label(snapshot)),
    error: (error) => calls.push(`error:${(error as Error).message}`),
    complete: () => calls.push('complete'),
  };
}

describe.each(IMPLEMENTATIONS)('like @xstate/react, with %s', (_, hooks, previews) => {
  /** The upload a new machine replaced: its machine, and the actor the hook gave for it. */
  type Previous = { machine: UploadMachine; actor: UploadActor };

  /** Makes the socket of an upload report `type`. */
  type Report = (machine: UploadMachine, type: SocketEvent['type']) => void;

  type Props = {
    machine: UploadMachine;
    kind: Kind;
    disabled: boolean;
    mode?: Mode;
    /** What the replaced upload does once the new one is in place, in the layout phase of the commit that replaces it. */
    inWindow?: (previous: Previous) => void;
  };

  type Replacement = {
    id?: string;
    edit?: Edit;
    disabled?: boolean;
    inWindow?: Props['inWindow'];
  };

  /**
   * Mounts an upload next to the overlay, with useActorRef given an inline or a stable observer that logs what it hears
   * to `calls`. `calls` starts empty after the mount, and each step pushes a marker before it acts, so `calls` shows
   * what the observer heard after which step. `mode` puts the upload in an Activity.
   */
  async function mountUpload(
    kind: Kind,
    { id = freshId('upload'), disabled = false, mode }: { id?: string; disabled?: boolean; mode?: Mode } = {},
  ) {
    const calls: string[] = [];
    const sockets = new Map<string, Socket>();
    let committed: UploadActor | undefined;
    function Upload({ machine, kind, disabled, inWindow }: Omit<Props, 'mode'>) {
      const inline = observe(calls);
      const [first] = React.useState(inline);
      const actorRef = hooks.useActorRef(machine, { debug: { disabled } } as never, kind === 'stable' ? first : inline);
      const previous = React.useRef<Previous>({ machine, actor: actorRef });
      // After the hook's own layout effect, and before @xstate/react's passive effect stops the replaced actor.
      React.useLayoutEffect(() => {
        committed = actorRef;
        if (previous.current.machine !== machine) inWindow?.(previous.current);
        previous.current = { machine, actor: actorRef };
      });
      return null;
    }
    function App({ mode, ...props }: Props) {
      const upload = <Upload {...props} />;
      return mode === undefined ? upload : <Activity mode={mode}>{upload}</Activity>;
    }
    const props: Props = {
      machine: createUploadMachine({ id, version: 'old' }, sockets),
      kind,
      disabled,
      mode,
    };
    const view = render(page(<App {...props} />));
    await flush();
    calls.length = 0;

    const update = async (patch: Partial<Props>): Promise<void> => {
      Object.assign(props, patch);
      view.rerender(page(<App {...props} />));
      await flush();
    };
    const socket = (machine: UploadMachine): Socket => {
      const send = sockets.get(String(machine.version));
      if (!send) throw new Error(`No socket runs for the ${machine.version} upload.`);
      return send;
    };
    /** Pushes the marker, runs the step, and logs each error that reached the page uncaught meanwhile. */
    const step = async (marker: string, run: () => unknown): Promise<void> => {
      calls.push(marker);
      const errors = await uncaught(run);
      calls.push(...errors.map((error) => `uncaught:${(error as Error).message}`));
    };
    return {
      calls,
      /** The socket of the upload of `machine` reports, past the hook's actor. */
      report: (machine: UploadMachine, type: SocketEvent['type']): void => socket(machine)({ type }),
      preview: (leaf: string) =>
        step(`[preview ${leaf}]`, async () => {
          if (previews) await preview(props.machine.id, [leaf]);
        }),
      /** Closes the preview of the upload, through its Release button. */
      release: () =>
        step('[release]', async () => {
          if (previews) await release(props.machine.id);
        }),
      finish: () => step('[finish]', () => socket(props.machine)({ type: 'FINISH' })),
      /** The socket reports an error the machine crashes on. */
      fail: () => step('[fail]', () => socket(props.machine)({ type: 'BREAK' })),
      /** The app stops the upload, through the hook's actor. */
      stop: () => step('[stop]', () => committed!.stop()),
      /**
       * A new machine replaces the actor: the same config again, as Fast Refresh gives it, or one with another id or
       * an edit. The same render can turn `disabled` on. `inWindow` is what the replaced upload does in the commit
       * that replaces it.
       */
      replace: async ({ id: newId = props.machine.id, edit, disabled, inWindow }: Replacement = {}): Promise<void> => {
        const version = props.machine.version === 'old' ? 'new' : 'newer';
        const machine = createUploadMachine({ id: newId, version, edit }, sockets);
        await step(disabled ? '[replace+disable]' : '[replace]', () =>
          update({
            machine,
            inWindow,
            ...(disabled === undefined ? {} : { disabled }),
          }),
        );
        props.inWindow = undefined;
      },
      disable: () => step('[disable]', () => update({ disabled: true })),
      enable: () => step('[debug on]', () => update({ disabled: false })),
      hide: () => step('[hide]', () => update({ mode: 'hidden' })),
      reveal: () => step('[reveal]', () => update({ mode: 'visible' })),
    };
  }

  test.each([
    [
      'an inline observer follows the new actor',
      'inline',
      ['[replace]', 'active:uploading (new)', '[finish]', 'done:uploaded (new)', 'complete'],
    ],
    [
      'a stable observer stays with the replaced actor, which tells it nothing more',
      'stable',
      ['[replace]', '[finish]'],
    ],
  ] as const)('a new machine replaces the actor while the upload runs: %s', async (_, kind, heard) => {
    const upload = await mountUpload(kind);

    await upload.replace();
    await upload.finish();
    expect(upload.calls).toEqual(heard);
  });

  describe('the actor is replaced during a preview', () => {
    describe.each(OBSERVERS)('%s given to useActorRef', (_, kind) => {
      test.each([
        [
          'the overlay is closed: the observer leaves the preview',
          'release',
          {
            inline: {
              control: ['[preview failed]', '[replace]', 'active:uploading (new)', '[release]'],
              stateViewer: [
                '[preview failed]',
                'active:failed (old)',
                '[replace]',
                'active:failed (new)',
                '[release]',
                'active:uploading (new)',
              ],
            },
            stable: {
              control: ['[preview failed]', '[replace]', '[release]'],
              // The stable observer stays with the replaced actor, so the release shows it that actor's real snapshot.
              stateViewer: [
                '[preview failed]',
                'active:failed (old)',
                '[replace]',
                '[release]',
                'active:uploading (old)',
              ],
            },
          },
        ],
        [
          'debug.disabled turns on: the observer leaves the preview',
          'disable',
          {
            inline: {
              control: ['[preview failed]', '[replace]', 'active:uploading (new)', '[disable]'],
              stateViewer: [
                '[preview failed]',
                'active:failed (old)',
                '[replace]',
                'active:failed (new)',
                '[disable]',
                'active:uploading (new)',
              ],
            },
            stable: {
              control: ['[preview failed]', '[replace]', '[disable]'],
              stateViewer: [
                '[preview failed]',
                'active:failed (old)',
                '[replace]',
                '[disable]',
                'active:uploading (old)',
              ],
            },
          },
        ],
      ] as const)('%s', async (_, end, heard) => {
        const upload = await mountUpload(kind);

        await upload.preview('failed');
        await upload.replace();
        await upload[end]();
        expect(upload.calls).toEqual(previews ? heard[kind].stateViewer : heard[kind].control);
      });

      test('the new machine registers under another id: the observer leaves the preview at once', async () => {
        const upload = await mountUpload(kind);

        await upload.preview('failed');
        await upload.replace({ id: freshId('upload-v2') });
        expect({
          previewing: header().previewing,
          calls: upload.calls,
        }).toEqual({
          previewing: '',
          calls: {
            inline: {
              control: ['[preview failed]', '[replace]', 'active:uploading (new)'],
              stateViewer: ['[preview failed]', 'active:failed (old)', '[replace]', 'active:uploading (new)'],
            },
            stable: {
              control: ['[preview failed]', '[replace]'],
              stateViewer: ['[preview failed]', 'active:failed (old)', '[replace]', 'active:uploading (old)'],
            },
          }[kind][previews ? 'stateViewer' : 'control'],
        });
      });

      describeWithActivity('an Activity hides the upload, which takes its preview with it', () => {
        test('the observer leaves the preview on the reveal', async () => {
          const upload = await mountUpload(kind, { mode: 'visible' });

          await upload.preview('failed');
          await upload.replace();
          await upload.hide();
          const hidden = header().previewing;
          await upload.reveal();
          expect({ hidden, calls: upload.calls }).toEqual({
            hidden: '',
            calls: {
              inline: {
                control: [
                  '[preview failed]',
                  '[replace]',
                  'active:uploading (new)',
                  '[hide]',
                  '[reveal]',
                  'active:uploading (new)',
                  'active:uploading (new)',
                ],
                stateViewer: [
                  '[preview failed]',
                  'active:failed (old)',
                  '[replace]',
                  'active:failed (new)',
                  '[hide]',
                  '[reveal]',
                  'active:uploading (new)',
                  'active:uploading (new)',
                ],
              },
              stable: {
                // On the reveal @xstate/react subscribes the observer to the new actor and starts it, twice under
                // StrictMode.
                control: [
                  '[preview failed]',
                  '[replace]',
                  '[hide]',
                  '[reveal]',
                  'active:uploading (new)',
                  'active:uploading (new)',
                ],
                // One snapshot more: the hook shows the observer the replaced actor's real snapshot when it connects
                // again on the reveal, before @xstate/react moves the observer to the new actor.
                stateViewer: [
                  '[preview failed]',
                  'active:failed (old)',
                  '[replace]',
                  '[hide]',
                  '[reveal]',
                  'active:uploading (old)',
                  'active:uploading (new)',
                  'active:uploading (new)',
                ],
              },
            }[kind][previews ? 'stateViewer' : 'control'],
          });
        });
      });
    });

    test.each([
      ['the overlay is closed', 'release'],
      ['debug.disabled turns on', 'disable'],
    ] as const)(
      'a component that mirrors the upload from a stable observer shows the real state when %s after a replacement',
      async (_, end) => {
        const id = freshId('upload');
        const sockets = new Map<string, Socket>();
        function Upload({ version, disabled }: { version: string; disabled: boolean }) {
          const machine = React.useMemo(() => createUploadMachine({ id, version }, sockets), [version]);
          const [status, setStatus] = React.useState('?');
          const [observer] = React.useState(() => (snapshot: UploadSnapshot) => setStatus(String(snapshot.value)));
          hooks.useActorRef(machine, { debug: { disabled } } as never, observer);
          return <output aria-label="upload">{status}</output>;
        }
        const status = () => screen.getByRole('status', { name: 'upload' }).textContent;
        const view = render(page(<Upload version="old" disabled={false} />));
        await flush();

        const mounted = status();
        if (previews) await preview(id, ['failed']);
        const previewed = status();
        view.rerender(page(<Upload version="new" disabled={false} />));
        await flush();
        const replaced = status();
        if (end === 'release') {
          if (previews) await release(id);
        } else {
          view.rerender(page(<Upload version="new" disabled />));
          await flush();
        }
        expect({ mounted, previewed, replaced, ended: status() }).toEqual({
          mounted: 'uploading',
          previewed: previews ? 'failed' : 'uploading',
          replaced: previews ? 'failed' : 'uploading',
          ended: 'uploading',
        });
      },
    );
  });

  describe('the actor ends during a preview, and a new machine replaces it: the held ending is owed', () => {
    describe('the new machine keeps the id', () => {
      describe.each(OBSERVERS)('%s given to useActorRef', (_, kind) => {
        test.each([
          [
            'finishes',
            'finish',
            {
              inline: {
                // XState repeats a finished actor's ending when @xstate/react starts the new actor from the done snapshot.
                control: [
                  '[finish]',
                  'done:uploaded (old)',
                  'complete',
                  '[replace]',
                  'done:uploaded (new)',
                  'complete',
                  '[release]',
                  '[preview failed]',
                  '[release]',
                ],
                // The preview of the finished upload loses its invoked socket, and the inline observer, which follows
                // the new actor, sees that actor's preview.
                stateViewer: [
                  '[finish]',
                  'active:failed (old)',
                  '[replace]',
                  'active:failed (new)',
                  '[release]',
                  'done:uploaded (old)',
                  'complete',
                  'done:uploaded (new)',
                  'complete',
                  '[preview failed]',
                  '[release]',
                ],
              },
              stable: {
                control: [
                  '[finish]',
                  'done:uploaded (old)',
                  'complete',
                  '[replace]',
                  '[release]',
                  '[preview failed]',
                  '[release]',
                ],
                stateViewer: [
                  '[finish]',
                  'active:failed (old)',
                  '[replace]',
                  '[release]',
                  'done:uploaded (old)',
                  'complete',
                  '[preview failed]',
                  '[release]',
                ],
              },
            },
          ],
          [
            'is stopped by the app',
            'stop',
            {
              // XState tells the observers of a stopped actor nothing when @xstate/react starts the new actor.
              inline: {
                control: ['[stop]', 'complete', '[replace]', '[release]', '[preview failed]', '[release]'],
                stateViewer: ['[stop]', '[replace]', '[release]', 'complete', '[preview failed]', '[release]'],
              },
              stable: {
                control: ['[stop]', 'complete', '[replace]', '[release]', '[preview failed]', '[release]'],
                stateViewer: ['[stop]', '[replace]', '[release]', 'complete', '[preview failed]', '[release]'],
              },
            },
          ],
          [
            'fails',
            'fail',
            {
              inline: {
                control: [
                  '[fail]',
                  'error:socket closed',
                  '[replace]',
                  'error:socket closed',
                  '[release]',
                  '[preview failed]',
                  '[release]',
                ],
                stateViewer: [
                  '[fail]',
                  '[replace]',
                  '[release]',
                  'error:socket closed',
                  'error:socket closed',
                  '[preview failed]',
                  '[release]',
                ],
              },
              // The stable observer stays with the replaced actor, so the new actor, started from the error snapshot,
              // has no observer with an error callback, and XState reports its error as unhandled.
              stable: {
                control: [
                  '[fail]',
                  'error:socket closed',
                  '[replace]',
                  'uncaught:socket closed',
                  '[release]',
                  '[preview failed]',
                  '[release]',
                ],
                stateViewer: [
                  '[fail]',
                  '[replace]',
                  'uncaught:socket closed',
                  '[release]',
                  'error:socket closed',
                  '[preview failed]',
                  '[release]',
                ],
              },
            },
          ],
        ] as const)(
          'the old actor %s during a preview: the observer hears the ending after the release, and no later preview',
          async (_, ending, heard) => {
            const upload = await mountUpload(kind);
            await upload.preview('failed');
            upload.calls.length = 0;

            await upload[ending]();
            await upload.replace();
            await upload.release();
            await upload.preview('failed');
            await upload.release();
            expect(upload.calls).toEqual(previews ? heard[kind].stateViewer : heard[kind].control);
          },
        );

        test('debug.disabled turning on while the preview is on tells the observer the ending at once', async () => {
          const upload = await mountUpload(kind);
          await upload.preview('failed');
          upload.calls.length = 0;

          await upload.stop();
          await upload.replace();
          await upload.disable();
          expect({ listed: header().machine, calls: upload.calls }).toEqual({
            listed: null,
            calls: previews
              ? ['[stop]', '[replace]', '[disable]', 'complete']
              : ['[stop]', 'complete', '[replace]', '[disable]'],
          });
        });

        describeWithActivity('an Activity hides the upload, which takes its preview with it', () => {
          test('the observer hears the ending on the reveal', async () => {
            const upload = await mountUpload(kind, { mode: 'visible' });
            await upload.preview('failed');
            upload.calls.length = 0;

            await upload.stop();
            await upload.replace();
            await upload.hide();
            const hidden = header().previewing;
            await upload.reveal();
            expect({ hidden, calls: upload.calls }).toEqual({
              hidden: '',
              calls: previews
                ? ['[stop]', '[replace]', '[hide]', '[reveal]', 'complete']
                : ['[stop]', 'complete', '[replace]', '[hide]', '[reveal]'],
            });
          });
        });
      });

      test('a finished actor replaced twice: the release settles each owed ending once, in order', async () => {
        const upload = await mountUpload('inline');
        await upload.preview('failed');
        upload.calls.length = 0;

        await upload.finish();
        await upload.replace();
        await upload.replace();
        await upload.release();
        expect(upload.calls).toEqual(
          previews
            ? [
                '[finish]',
                'active:failed (old)',
                '[replace]',
                'active:failed (new)',
                '[replace]',
                'active:failed (newer)',
                '[release]',
                'done:uploaded (old)',
                'complete',
                'done:uploaded (new)',
                'complete',
                'done:uploaded (newer)',
                'complete',
              ]
            : [
                '[finish]',
                'done:uploaded (old)',
                'complete',
                '[replace]',
                'done:uploaded (new)',
                'complete',
                '[replace]',
                'done:uploaded (newer)',
                'complete',
                '[release]',
              ],
        );
      });

      describe('Fast Refresh edits the states, with an inline observer', () => {
        test("the edit removes the previewed state of a finished upload: the old ending at once, then XState's", async () => {
          const upload = await mountUpload('inline');
          await upload.preview('failed');
          upload.calls.length = 0;

          await upload.finish();
          await upload.replace({ edit: 'without failed' });
          expect({
            previewing: header().previewing,
            calls: upload.calls,
          }).toEqual({
            previewing: '',
            calls: previews
              ? [
                  '[finish]',
                  'active:failed (old)',
                  '[replace]',
                  'done:uploaded (old)',
                  'complete',
                  'done:uploaded (new)',
                  'complete',
                ]
              : ['[finish]', 'done:uploaded (old)', 'complete', '[replace]', 'done:uploaded (new)', 'complete'],
          });
        });

        test("the edit removes the previewed state while the upload runs: the new actor's real snapshot once", async () => {
          const upload = await mountUpload('inline');

          await upload.preview('failed');
          await upload.replace({ edit: 'without failed' });
          expect({
            previewing: header().previewing,
            calls: upload.calls,
          }).toEqual({
            previewing: '',
            calls: previews
              ? ['[preview failed]', 'active:failed (old)', '[replace]', 'active:uploading (new)']
              : ['[preview failed]', '[replace]', 'active:uploading (new)'],
          });
        });

        test('the edit adds a state the developer then previews: the old ending waits for the release', async () => {
          const upload = await mountUpload('inline');
          await upload.preview('failed');
          upload.calls.length = 0;

          await upload.finish();
          await upload.replace({ edit: 'with retrying' });
          upload.calls.push('[preview retrying]');
          if (previews) await clickLeaf('retrying');
          await upload.release();
          expect(upload.calls).toEqual(
            previews
              ? [
                  '[finish]',
                  'active:failed (old)',
                  '[replace]',
                  'active:failed (new)',
                  '[preview retrying]',
                  'active:retrying (new)',
                  '[release]',
                  'done:uploaded (old)',
                  'complete',
                  'done:uploaded (new)',
                  'complete',
                ]
              : [
                  '[finish]',
                  'done:uploaded (old)',
                  'complete',
                  '[replace]',
                  'done:uploaded (new)',
                  'complete',
                  '[preview retrying]',
                  '[release]',
                ],
          );
        });
      });

      describeWithActivity('an Activity hides a finished upload, which takes its preview with it', () => {
        test("replaced while hidden, with an inline observer: the old ending on the reveal, then XState's", async () => {
          const upload = await mountUpload('inline', { mode: 'visible' });
          await upload.preview('failed');
          upload.calls.length = 0;

          await upload.finish();
          await upload.hide();
          await upload.replace();
          const hidden = header().previewing;
          await upload.reveal();
          expect({ hidden, calls: upload.calls }).toEqual({
            hidden: '',
            // On the reveal @xstate/react starts the new actor from the done snapshot, twice under StrictMode.
            calls: previews
              ? [
                  '[finish]',
                  'active:failed (old)',
                  '[hide]',
                  '[replace]',
                  '[reveal]',
                  'done:uploaded (old)',
                  'complete',
                  'done:uploaded (new)',
                  'complete',
                  'done:uploaded (new)',
                  'complete',
                ]
              : [
                  '[finish]',
                  'done:uploaded (old)',
                  'complete',
                  '[hide]',
                  '[replace]',
                  '[reveal]',
                  'done:uploaded (new)',
                  'complete',
                  'done:uploaded (new)',
                  'complete',
                ],
          });
        });
      });
    });

    describe('the new machine registers under another id', () => {
      test.each(OBSERVERS)(
        '%s given to useActorRef hears the old actor finish at the replacement, as nothing previews the new actor',
        async (_, kind) => {
          const upload = await mountUpload(kind);
          await upload.preview('failed');
          upload.calls.length = 0;

          await upload.finish();
          await upload.replace({ id: freshId('upload-v2') });
          const replaced = header().previewing;
          await upload.preview('failed');
          await upload.release();
          expect({ replaced, calls: upload.calls }).toEqual({
            replaced: '',
            calls: {
              inline: {
                control: [
                  '[finish]',
                  'done:uploaded (old)',
                  'complete',
                  '[replace]',
                  'done:uploaded (new)',
                  'complete',
                  '[preview failed]',
                  '[release]',
                ],
                stateViewer: [
                  '[finish]',
                  'active:failed (old)',
                  '[replace]',
                  'done:uploaded (old)',
                  'complete',
                  'done:uploaded (new)',
                  'complete',
                  '[preview failed]',
                  '[release]',
                ],
              },
              stable: {
                control: ['[finish]', 'done:uploaded (old)', 'complete', '[replace]', '[preview failed]', '[release]'],
                stateViewer: [
                  '[finish]',
                  'active:failed (old)',
                  '[replace]',
                  'done:uploaded (old)',
                  'complete',
                  '[preview failed]',
                  '[release]',
                ],
              },
            }[kind][previews ? 'stateViewer' : 'control'],
          });
        },
      );
    });
  });

  describe('the replaced actor sends in the commit window, before the passive effects move the observer', () => {
    test.each([
      [
        'an inline observer never hears an update the old actor makes under a preview',
        'inline',
        (previous: Previous, report: Report) => report(previous.machine, 'PAUSE'),
        {
          control: ['[preview failed]', '[replace]', 'active:paused (old)', 'active:uploading (new)', '[release]'],
          stateViewer: [
            '[preview failed]',
            'active:failed (old)',
            '[replace]',
            'active:failed (new)',
            '[release]',
            'active:uploading (new)',
          ],
        },
      ],
      [
        'a stable observer hears the update the old actor made under a preview when the preview ends',
        'stable',
        (previous: Previous, report: Report) => report(previous.machine, 'PAUSE'),
        {
          control: ['[preview failed]', '[replace]', 'active:paused (old)', '[release]'],
          stateViewer: ['[preview failed]', 'active:failed (old)', '[replace]', '[release]', 'active:paused (old)'],
        },
      ],
      [
        'an inline observer hears the old actor finish under a preview when the preview ends, before the new actor',
        'inline',
        (previous: Previous, report: Report) => report(previous.machine, 'FINISH'),
        {
          control: [
            '[preview failed]',
            '[replace]',
            'done:uploaded (old)',
            'complete',
            'active:uploading (new)',
            '[release]',
          ],
          stateViewer: [
            '[preview failed]',
            'active:failed (old)',
            '[replace]',
            'active:failed (new)',
            '[release]',
            'done:uploaded (old)',
            'complete',
            'active:uploading (new)',
          ],
        },
      ],
    ] as const)('%s', async (_, kind, inWindow, heard) => {
      const upload = await mountUpload(kind);

      await upload.preview('failed');
      await upload.replace({
        inWindow: (previous) => inWindow(previous, upload.report),
      });
      await upload.release();
      expect(upload.calls).toEqual(previews ? heard.stateViewer : heard.control);
    });

    test("an observer that hears the old actor fail still hears the new actor's previews", async () => {
      const upload = await mountUpload('inline');

      await upload.replace({
        inWindow: (previous) => upload.report(previous.machine, 'BREAK'),
      });
      await upload.preview('failed');
      await upload.release();
      expect(upload.calls).toEqual(
        previews
          ? [
              '[replace]',
              'error:socket closed',
              'active:uploading (new)',
              '[preview failed]',
              'active:failed (new)',
              '[release]',
              'active:uploading (new)',
            ]
          : ['[replace]', 'error:socket closed', 'active:uploading (new)', '[preview failed]', '[release]'],
      );
    });

    test("the component cancels the previous upload through its actor: the new upload's previews and held ending reach the observer", async () => {
      const upload = await mountUpload('inline');

      await upload.replace({
        inWindow: (previous) => previous.actor.send({ type: 'CANCEL' }),
      });
      await upload.preview('failed');
      await upload.finish();
      await upload.release();
      expect(upload.calls).toEqual(
        previews
          ? [
              '[replace]',
              'done:cancelled (old)',
              'complete',
              'active:uploading (new)',
              '[preview failed]',
              'active:failed (new)',
              '[finish]',
              'active:failed (new)',
              '[release]',
              'done:uploaded (new)',
              'complete',
            ]
          : [
              '[replace]',
              'done:cancelled (old)',
              'complete',
              'active:uploading (new)',
              '[preview failed]',
              '[finish]',
              'done:uploaded (new)',
              'complete',
              '[release]',
            ],
      );
    });

    test("an observer without next reads the old actor's output through the actor the hook gave as it hears it finish", async () => {
      const id = freshId('upload');
      const sockets = new Map<string, Socket>();
      const calls: string[] = [];
      let first: UploadActor | undefined;
      function Upload({ version }: { version: string }) {
        const machine = React.useMemo(() => createUploadMachine({ id, version }, sockets), [version]);
        const [observer] = React.useState<Observer<UploadSnapshot>>(() => ({
          complete: () => calls.push(`complete: ${String(first?.getSnapshot().value)}`),
        }));
        const actorRef = hooks.useActorRef(machine, undefined, observer);
        const previous = React.useRef(version);
        React.useLayoutEffect(() => {
          first ??= actorRef;
          if (previous.current !== version) sockets.get(previous.current)?.({ type: 'FINISH' });
          previous.current = version;
        });
        return null;
      }
      const view = render(page(<Upload version="old" />));
      await flush();

      calls.push('[preview failed]');
      if (previews) await preview(id, ['failed']);
      calls.push('[replace]');
      view.rerender(page(<Upload version="new" />));
      await flush();
      expect(calls).toEqual(['[preview failed]', '[replace]', 'complete: uploaded']);
    });
  });

  describe('one render replaces the actor and turns debug.disabled on', () => {
    test("an inline observer hears only the new actor's real snapshot, and the upload leaves the overlay", async () => {
      const upload = await mountUpload('inline');

      await upload.preview('failed');
      await upload.replace({ disabled: true });
      expect({ listed: header().machine, calls: upload.calls }).toEqual({
        listed: null,
        calls: previews
          ? ['[preview failed]', 'active:failed (old)', '[replace+disable]', 'active:uploading (new)']
          : ['[preview failed]', '[replace+disable]', 'active:uploading (new)'],
      });
    });
  });

  describe('a stable observer, the actor replaced while debug.disabled is on', () => {
    type DisabledAt = 'from the mount' | 'after the mount' | 'never';

    /** Mounts the upload with a stable observer, debug.disabled turned on at `disabledAt`, and `calls` empty. */
    async function mountDisabled(disabledAt: DisabledAt) {
      const upload = await mountUpload('stable', {
        disabled: disabledAt === 'from the mount',
      });
      if (disabledAt === 'after the mount') await upload.disable();
      upload.calls.length = 0;
      return upload;
    }

    test.each<[string, DisabledAt, SocketEvent['type'] | undefined, string[]]>([
      [
        'debug.disabled after the mount, the old upload finishing in the window: its done snapshot once when debug is turned back on',
        'after the mount',
        'FINISH',
        ['[replace]', 'done:uploaded (old)', 'complete', '[debug on]'],
      ],
      [
        'debug on throughout, the old upload finishing in the window: its done snapshot once, whatever debug.disabled does afterwards',
        'never',
        'FINISH',
        ['[replace]', 'done:uploaded (old)', 'complete', '[disable]', '[debug on]'],
      ],
      [
        'debug.disabled after the mount, the old upload silent in the window: nothing when debug is turned back on',
        'after the mount',
        undefined,
        ['[replace]', '[debug on]'],
      ],
      [
        'debug.disabled from the mount, the old upload finishing in the window: its done snapshot once',
        'from the mount',
        'FINISH',
        ['[replace]', 'done:uploaded (old)', 'complete', '[debug on]'],
      ],
      [
        'debug.disabled after the mount, the old upload pausing in the window: its update once when debug is turned back on',
        'after the mount',
        'PAUSE',
        ['[replace]', 'active:paused (old)', '[debug on]'],
      ],
    ])('%s', async (_, disabledAt, reports, heard) => {
      const upload = await mountDisabled(disabledAt);

      await upload.replace({
        inWindow: (previous) => {
          if (reports) upload.report(previous.machine, reports);
        },
      });
      if (disabledAt === 'never') await upload.disable();
      await upload.enable();
      expect(upload.calls).toEqual(heard);
    });

    describeWithActivity('an Activity hides and reveals the upload', () => {
      test("debug.disabled after the mount, the old upload pausing in the window: its update once, then the new actor's starts", async () => {
        const upload = await mountUpload('stable', { mode: 'visible' });
        await upload.disable();
        upload.calls.length = 0;

        await upload.replace({
          inWindow: (previous) => upload.report(previous.machine, 'PAUSE'),
        });
        await upload.hide();
        await upload.reveal();
        // On the reveal @xstate/react subscribes the observer to the new actor and starts it, twice under StrictMode.
        expect(upload.calls).toEqual([
          '[replace]',
          'active:paused (old)',
          '[hide]',
          '[reveal]',
          'active:uploading (new)',
          'active:uploading (new)',
        ]);
      });
    });
  });

  describe('the actor is replaced while the upload runs, and the new actor previewed', () => {
    test.each([
      [
        "a stable observer stays with the replaced actor: none of the new actor's previews or updates",
        'stable',
        {
          control: ['[replace]', '[preview failed]', '[release]', '[finish]'],
          stateViewer: ['[replace]', '[preview failed]', '[release]', '[finish]'],
        },
      ],
      [
        'an inline observer follows the new actor: previews, the real snapshot on release, updates',
        'inline',
        {
          control: [
            '[replace]',
            'active:uploading (new)',
            '[preview failed]',
            '[release]',
            '[finish]',
            'done:uploaded (new)',
            'complete',
          ],
          stateViewer: [
            '[replace]',
            'active:uploading (new)',
            '[preview failed]',
            'active:failed (new)',
            '[release]',
            'active:uploading (new)',
            '[finish]',
            'done:uploaded (new)',
            'complete',
          ],
        },
      ],
    ] as const)('%s', async (_, kind, heard) => {
      const upload = await mountUpload(kind);

      await upload.replace();
      await upload.preview('failed');
      await upload.release();
      await upload.finish();
      expect(upload.calls).toEqual(previews ? heard.stateViewer : heard.control);
    });
  });

  describe('the actor is replaced after the upload finished', () => {
    test.each([
      [
        'a stable observer that heard the upload finish hears no preview and no done snapshot again',
        'stable',
        ['[finish]', 'done:uploaded (old)', 'complete', '[replace]', '[preview failed]', '[release]'],
      ],
      [
        "an inline observer hears the new actor's done snapshot, then no preview of it",
        'inline',
        [
          '[finish]',
          'done:uploaded (old)',
          'complete',
          '[replace]',
          'done:uploaded (new)',
          'complete',
          '[preview failed]',
          '[release]',
        ],
      ],
    ] as const)('%s', async (_, kind, heard) => {
      const upload = await mountUpload(kind);

      await upload.finish();
      await upload.replace();
      await upload.preview('failed');
      await upload.release();
      expect(upload.calls).toEqual(heard);
    });
  });

  describeWithActivity(
    'an Activity reveal subscribes a stable observer left on the replaced actor to the new actor',
    () => {
      test.each([
        ['previewed before the reveal', true],
        ['not previewed before the reveal', false],
      ])("%s: it hears the new actor's updates and previews from then on", async (_, previewedBefore) => {
        const upload = await mountUpload('stable', { mode: 'visible' });

        await upload.replace();
        if (previewedBefore) {
          await upload.preview('failed');
          await upload.release();
        }
        await upload.hide();
        await upload.reveal();
        await upload.preview('failed');
        await upload.release();
        await upload.finish();
        const before = previewedBefore ? ['[preview failed]', '[release]'] : [];
        expect(upload.calls).toEqual(
          previews
            ? [
                '[replace]',
                ...before,
                '[hide]',
                '[reveal]',
                'active:uploading (new)',
                'active:uploading (new)',
                '[preview failed]',
                'active:failed (new)',
                '[release]',
                'active:uploading (new)',
                '[finish]',
                'done:uploaded (new)',
                'complete',
              ]
            : [
                '[replace]',
                ...before,
                '[hide]',
                '[reveal]',
                'active:uploading (new)',
                'active:uploading (new)',
                '[preview failed]',
                '[release]',
                '[finish]',
                'done:uploaded (new)',
                'complete',
              ],
        );
      });
    },
  );
});
