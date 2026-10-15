// When the machine a hook gets has a new config (Fast Refresh re-evaluates the machine's module, or the component
// builds its machine from a prop), @xstate/react replaces the hook's actor: it creates a new actor from the old one's
// persisted snapshot, stops the old one and starts the new one. With @xstate/react, which has no previews, the observer
// given to useActorRef hears the upload finish when the old actor finishes, and an inline observer, which @xstate/react
// subscribes to the new actor, hears the ending again when @xstate/react starts that actor from the done snapshot. If
// the old actor finished while a preview showed, state-viewer holds its ending back, and the replacement doesn't
// cancel it: the ending is owed, and the observer hears it once the hook's actor is no longer previewed, before
// anything about the new actor. When that is depends on where the
// preview goes:
// - The new actor registers under another id (a machine whose id follows a prop, or an anonymous machine whose
//   fallback id changes when Fast Refresh adds a state): at once. The registry drops the old id's preview, and
//   nothing previews the new actor, so a stable and an inline observer hear as many completes as with @xstate/react,
//   the old actor's first. When the id stays the same (the control), the preview carries over to the new actor and
//   the ending waits for the release.
// - Fast Refresh removes the previewed state: at once too, as the new actor can't show the preview, which is released.
// - The developer switches the preview to a state only the new machine has: at the release. The old machine can't
//   show that state, but the hook's actor is still previewed.
// - An Activity hides the component, a new machine replaces the actor and the preview is released while hidden: on
//   the reveal, when the hook connects again.
// The new actor's real snapshot comes from XState when @xstate/react starts it, never earlier from the hook, so the
// observer hears it as often as with @xstate/react: no extra done snapshot after the reveal or when Fast Refresh
// removes the previewed state, and no extra active snapshot when a replacement can't show the preview of an upload
// that's still running. Each snapshot below is labelled with the actor it's of: the replaced one (old) or the new one.

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fromCallback, setup, type Actor, type Observer, type SnapshotFrom } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { flush, keyOf, registry, resetRegistry } from '../xstate/helpers';

/** What the invoked socket uses to tell the machine the upload finished, past the proxy (previews block sends). */
let finishUpload: (() => void) | undefined;

/** Every machine the current test created, in order: the replaced actor's, then the new actor's. */
let created: unknown[] = [];

type UploadConfig = {
  /** The machine's id; null leaves it anonymous, so the registry gives it a fallback id, a hash of its states. */
  id?: string | null;
  /** Whether the machine has the `failed` state the tests preview. */
  failed?: boolean;
  /** Whether the machine has a `paused` state, which Fast Refresh adds. */
  paused?: boolean;
};

/** A fresh machine from a fresh config each call: what Fast Refresh, or a machine built from props, gives the hook. */
function createUploadMachine({ id = 'upload', failed = true, paused = false }: UploadConfig = {}) {
  const machine = setup({
    actors: {
      socket: fromCallback(({ sendBack }) => {
        finishUpload = () => sendBack({ type: 'UPLOADED' });
        return () => {
          finishUpload = undefined;
        };
      }),
    },
  }).createMachine({
    ...(id === null ? {} : { id }),
    initial: 'uploading',
    states: {
      uploading: { invoke: { src: 'socket' }, on: { UPLOADED: 'uploaded' } },
      ...(failed ? { failed: {} } : {}),
      ...(paused ? { paused: {} } : {}),
      uploaded: { type: 'final' },
    },
  });
  created.push(machine);
  return machine;
}

type UploadMachine = ReturnType<typeof createUploadMachine>;
type UploadActor = Actor<UploadMachine>;
type UploadSnapshot = SnapshotFrom<UploadMachine>;
type Hooks = Pick<typeof xstateReact, 'useActorRef'>;
type Mode = 'visible' | 'hidden';
type Kind = 'inline' | 'stable';

const IMPLEMENTATIONS: [name: string, hooks: Hooks, previews: boolean][] = [
  ['@xstate/react (control)', xstateReact, false],
  ['state-viewer/xstate', stateViewer as unknown as Hooks, true],
];

/** A new observer on every render, as apps usually write it, or the first render's throughout. */
const OBSERVERS: [name: string, kind: Kind][] = [
  ['an inline observer', 'inline'],
  ['a stable observer', 'stable'],
];

/** When state-viewer's observer hears the old actor's owed ending. */
type HeardAt = 'replacement' | 'release';

/**
 * What gives the hook a machine with a new config, and when state-viewer's observer hears the old actor's ending: at
 * the replacement when the new actor registers under another id, at the release when it keeps the old one's.
 */
const REPLACEMENTS: [what: string, before: UploadConfig, after: UploadConfig, heardAt: HeardAt][] = [
  ['a machine whose id follows a prop', { id: 'upload /upload' }, { id: 'upload /v2/upload' }, 'replacement'],
  ['Fast Refresh adding a state to an anonymous machine', { id: null }, { id: null, paused: true }, 'replacement'],
  ['a machine with the same id (control)', {}, {}, 'release'],
];

/**
 * What the observer hears when the old actor finishes during a preview of `failed`, a new machine replaces it, the
 * preview is released, and the machine is previewed and released again, under StrictMode. With state-viewer the
 * finishing actor's preview loses the invoked socket (`active:failed`), and an inline observer, subscribed to the new
 * actor, sees the new actor's preview when one carries over to it.
 */
const HEARD: { control: Record<Kind, string[]>; stateViewer: Record<HeardAt, Record<Kind, string[]>> } = {
  control: {
    inline: [
      '[finish]',
      'next:done:uploaded (old)',
      'complete',
      '[replace]',
      'next:done:uploaded (new)',
      'complete',
      '[release]',
      '[preview again]',
    ],
    stable: ['[finish]', 'next:done:uploaded (old)', 'complete', '[replace]', '[release]', '[preview again]'],
  },
  stateViewer: {
    replacement: {
      inline: [
        '[finish]',
        'next:active:failed (old)',
        '[replace]',
        'next:done:uploaded (old)',
        'complete',
        'next:done:uploaded (new)',
        'complete',
        '[release]',
        '[preview again]',
      ],
      stable: [
        '[finish]',
        'next:active:failed (old)',
        '[replace]',
        'next:done:uploaded (old)',
        'complete',
        '[release]',
        '[preview again]',
      ],
    },
    release: {
      inline: [
        '[finish]',
        'next:active:failed (old)',
        '[replace]',
        'next:active:failed (new)',
        '[release]',
        'next:done:uploaded (old)',
        'complete',
        'next:done:uploaded (new)',
        'complete',
        '[preview again]',
      ],
      stable: [
        '[finish]',
        'next:active:failed (old)',
        '[replace]',
        '[release]',
        'next:done:uploaded (old)',
        'complete',
        '[preview again]',
      ],
    },
  },
};

const Activity = (
  React as unknown as { Activity: React.ComponentType<{ mode: Mode; children: React.ReactNode }> }
).Activity;

/** The actor a snapshot is of, by the machine it comes from: the replaced one (old) or the new one. */
const actorOf = (snapshot: UploadSnapshot): string => ['old', 'new'][created.indexOf(snapshot.machine)] ?? 'unknown';

const label = (snapshot: UploadSnapshot): string =>
  `${snapshot.status}:${String(snapshot.value)} (${actorOf(snapshot)})`;

/** What the observer heard of how the actors ended: the done snapshots and completes. */
const endingIn = (calls: string[]): string[] =>
  calls.filter((call) => call === 'complete' || call.startsWith('next:done:'));

/** The only registered machine's instance key, whatever its id. */
function onlyKey(): string {
  const { machines } = registry().getSnapshot();
  expect(machines).toHaveLength(1);
  return keyOf(machines[0]);
}

beforeEach(() => {
  resetRegistry();
  finishUpload = undefined;
  created = [];
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
    if (previews) act(() => registry().preview(onlyKey(), { leaves }));
    await flush();
  }

  /** Closes the overlay, ending the preview. */
  async function release(): Promise<void> {
    if (previews) act(() => registry().release());
    await flush();
  }

  type Props = { machine: UploadMachine; mode: Mode };

  /**
   * Mounts the upload of `machine` in an Activity, with useActorRef given an observer that logs each snapshot to
   * `calls` as `next:status:value (old|new)`, and complete as `complete`. `calls` holds only what came after the mount.
   * `update()` renders the app again with new props: a new machine, or the Activity's mode.
   */
  async function mount(calls: string[], kind: Kind, machine: UploadMachine) {
    let actorRef: UploadActor | undefined;
    function Upload({ machine }: Pick<Props, 'machine'>) {
      const inline: Observer<UploadSnapshot> = {
        next: (snapshot) => calls.push(`next:${label(snapshot)}`),
        complete: () => calls.push('complete'),
      };
      const [first] = React.useState(inline);
      actorRef = hooks.useActorRef(machine, undefined, kind === 'stable' ? first : inline);
      return null;
    }
    function App({ machine, mode }: Props) {
      return (
        <Activity mode={mode}>
          <Upload machine={machine} />
        </Activity>
      );
    }
    const props: Props = { machine, mode: 'visible' };
    const view = render(<App {...props} />);
    await flush();
    calls.length = 0;
    return {
      actor: (): UploadActor => actorRef!,
      update: async (patch: Partial<Props>): Promise<void> => {
        Object.assign(props, patch);
        view.rerender(<App {...props} />);
        await flush();
      },
    };
  }

  /** Previews `failed`, and the upload finishes underneath: the real actor takes it while the preview shows. */
  async function finishDuringPreview(calls: string[]): Promise<void> {
    await preview(['failed']);
    calls.length = 0;
    calls.push('[finish]');
    act(() => finishUpload!());
    await flush();
  }

  /** Renders the upload with `machine`, a new config, and checks @xstate/react replaced the actor. */
  async function replace(
    calls: string[],
    upload: Awaited<ReturnType<typeof mount>>,
    machine: UploadMachine,
  ): Promise<void> {
    calls.push('[replace]');
    const replaced = upload.actor();
    await upload.update({ machine });
    expect(upload.actor()).not.toBe(replaced);
  }

  describe.each(OBSERVERS)('%s given to useActorRef', (_observer, kind) => {
    describe.each(REPLACEMENTS)('%s replaces the actor', (_what, before, after, heardAt) => {
      test(`the old actor finishes during a preview: the observer hears it at the ${heardAt}`, async () => {
        const calls: string[] = [];
        const upload = await mount(calls, kind, createUploadMachine(before));
        const oldKey = previews ? onlyKey() : '';
        await finishDuringPreview(calls);
        await replace(calls, upload, createUploadMachine(after));
        if (previews && heardAt === 'replacement') {
          // The new actor is listed under another key, and the old key's preview is gone with the old instance.
          expect(onlyKey()).not.toBe(oldKey);
          expect(registry().getSnapshot().overrides).toEqual({});
        } else if (previews) {
          // Under the same key, the preview carries over to the new actor.
          expect(onlyKey()).toBe(oldKey);
          expect(Object.keys(registry().getSnapshot().overrides)).toEqual([oldKey]);
        }
        calls.push('[release]');
        await release();
        expect(registry().getSnapshot().overrides).toEqual({});
        // The observer has been told how the actor ended: a later preview of the new machine shows it nothing.
        calls.push('[preview again]');
        await preview(['failed']);
        await release();

        const control = HEARD.control[kind];
        expect(calls).toEqual(previews ? HEARD.stateViewer[heardAt][kind] : control);
        // As many done snapshots and completes as with @xstate/react, and none of them while a preview hides them.
        expect(endingIn(calls)).toEqual(endingIn(control));
        const heard = calls.indexOf(heardAt === 'release' ? '[release]' : '[replace]');
        if (previews) expect(endingIn(calls.slice(0, heard))).toEqual([]);
      });
    });
  });

  describe('an inline observer given to useActorRef, the new machine keeping its id', () => {
    test('Fast Refresh removes the previewed state of a finished upload: the old ending, then XState’s', async () => {
      const calls: string[] = [];
      const upload = await mount(calls, 'inline', createUploadMachine());
      await finishDuringPreview(calls);
      await replace(calls, upload, createUploadMachine({ failed: false }));
      // The new actor can't show `failed`: its registration releases the preview.
      if (previews) expect(registry().getSnapshot().overrides).toEqual({});

      const control = [
        '[finish]',
        'next:done:uploaded (old)',
        'complete',
        '[replace]',
        'next:done:uploaded (new)',
        'complete',
      ];
      expect(calls).toEqual(
        previews
          ? [
              '[finish]',
              'next:active:failed (old)',
              '[replace]',
              'next:done:uploaded (old)',
              'complete',
              'next:done:uploaded (new)',
              'complete',
            ]
          : control,
      );
      expect(endingIn(calls)).toEqual(endingIn(control));
    });

    test('Fast Refresh removes the previewed state while the upload runs: the new actor’s snapshot once', async () => {
      const calls: string[] = [];
      const upload = await mount(calls, 'inline', createUploadMachine());
      calls.push('[preview]');
      await preview(['failed']);
      await replace(calls, upload, createUploadMachine({ failed: false }));
      if (previews) expect(registry().getSnapshot().overrides).toEqual({});

      expect(calls).toEqual(
        previews
          ? ['[preview]', 'next:active:failed (old)', '[replace]', 'next:active:uploading (new)']
          : ['[preview]', '[replace]', 'next:active:uploading (new)'],
      );
    });

    test('Fast Refresh adds a state the developer then previews: the old ending waits for the release', async () => {
      const calls: string[] = [];
      const upload = await mount(calls, 'inline', createUploadMachine());
      await finishDuringPreview(calls);
      await replace(calls, upload, createUploadMachine({ paused: true }));
      // Only the new machine has `paused`.
      calls.push('[preview paused]');
      await preview(['paused']);
      if (previews) expect(registry().getOverride(onlyKey())?.leaves).toEqual(['paused']);
      calls.push('[release]');
      await release();

      const control = [
        '[finish]',
        'next:done:uploaded (old)',
        'complete',
        '[replace]',
        'next:done:uploaded (new)',
        'complete',
        '[preview paused]',
        '[release]',
      ];
      expect(calls).toEqual(
        previews
          ? [
              '[finish]',
              'next:active:failed (old)',
              '[replace]',
              'next:active:failed (new)',
              '[preview paused]',
              'next:active:paused (new)',
              '[release]',
              'next:done:uploaded (old)',
              'complete',
              'next:done:uploaded (new)',
              'complete',
            ]
          : control,
      );
      expect(endingIn(calls)).toEqual(endingIn(control));
      // Nothing of how either actor ended while a preview shows.
      if (previews) expect(endingIn(calls.slice(0, calls.indexOf('[release]')))).toEqual([]);
    });

    test('replaced and released while an Activity hides it: the old ending on the reveal, then XState’s', async () => {
      const calls: string[] = [];
      const upload = await mount(calls, 'inline', createUploadMachine());
      await finishDuringPreview(calls);
      calls.push('[hide]');
      await upload.update({ mode: 'hidden' });
      await replace(calls, upload, createUploadMachine());
      calls.push('[release]');
      await release();
      calls.push('[reveal]');
      await upload.update({ mode: 'visible' });

      // @xstate/react: the finish, then the new actor's ending at each StrictMode start on the reveal.
      const control = [
        '[finish]',
        'next:done:uploaded (old)',
        'complete',
        '[hide]',
        '[replace]',
        '[release]',
        '[reveal]',
        'next:done:uploaded (new)',
        'complete',
        'next:done:uploaded (new)',
        'complete',
      ];
      expect(calls).toEqual(
        previews
          ? [
              '[finish]',
              'next:active:failed (old)',
              '[hide]',
              '[replace]',
              '[release]',
              '[reveal]',
              'next:done:uploaded (old)',
              'complete',
              'next:done:uploaded (new)',
              'complete',
              'next:done:uploaded (new)',
              'complete',
            ]
          : control,
      );
      expect(endingIn(calls)).toEqual(endingIn(control));
    });
  });
});
