// A component builds its upload machine from props and mirrors the upload's state (into React state, a store, the
// URL) through the observer it gives useActorRef. When the props change during a preview, @xstate/react replaces the
// actor (spec §10.2: "a machine built from props"): it creates a new actor from the old one's persisted snapshot,
// stops the old one and starts the new one, and subscribes the observer again only when the observer changes or its
// effects run again (spec §10.2, "Observers and the actor's ending"). The real actor never leaves `uploading`, so once
// the preview ends the observer's last value is `uploading`, as with @xstate/react, which has no previews (R13):
// - An inline observer, a new one on every render, follows the new actor. While the new actor registers under the
//   same instance key the preview carries over, so it hears the new actor's preview, then that actor's real snapshot
//   once when the preview ends: on the release, or when debug.disabled turns on. When the new machine registers under
//   another id nothing previews it, and the observer hears its real snapshot at once. It never hears the replaced
//   actor's real snapshot and the new one's both.
// - A stable observer (useCallback) stays subscribed to the replaced actor, which tells it nothing more, and
//   state-viewer shows it none of the new actor's previews. The last thing it saw is the replaced actor's preview, so
//   the hook shows it that actor's real snapshot when the preview ends (the release, debug.disabled turning on), and
//   at once when the new machine registers under another id, since nothing previews the hook's actor any more.
//   Without that, state mirrored from it would keep a state the upload was never in after the overlay closes.
// - When an Activity hides the component and the preview is released while it's hidden, the observer hears the real
//   snapshot on the reveal, when @xstate/react restarts the actor (twice under StrictMode). A stable observer hears
//   the replaced actor's real snapshot first, when the hook connects again: one `uploading` more than with
//   @xstate/react, all of them the real state.
// Without a replacement, either observer hears the preview, then the real snapshot on the release.

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import * as React from 'react';
import { useCallback } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createMachine, type Actor, type SnapshotFrom } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

/** A machine built from props: a new config whenever the endpoint or the machine id changes. */
function createUploadMachine(endpoint: string, id = 'upload') {
  return createMachine({
    id,
    initial: 'uploading',
    context: { endpoint },
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
type Mode = 'visible' | 'hidden';
type Kind = 'inline' | 'stable';

const IMPLEMENTATIONS: [name: string, hooks: Hooks, previews: boolean][] = [
  ['@xstate/react (control)', xstateReact, false],
  ['state-viewer/xstate', stateViewer as unknown as Hooks, true],
];

/** A new observer on every render, as apps usually write it, or the first render's throughout (useCallback). */
const OBSERVERS: [name: string, kind: Kind][] = [
  ['an inline observer', 'inline'],
  ['a stable observer', 'stable'],
];

/** How the preview of the replaced actor ends while the component is shown. */
const ENDS: [how: string, end: 'release' | 'disable'][] = [
  ['the overlay is closed', 'release'],
  ['debug.disabled turns on', 'disable'],
];

type Scenario = 'same machine' | 'release' | 'disable' | 'new id' | 'release while hidden';

/**
 * What the observer hears after the mount, under StrictMode, when `failed` is previewed and then each step runs, with
 * a marker pushed before each step.
 */
const HEARD: Record<Scenario, Record<Kind, { control: string[]; stateViewer: string[] }>> = {
  'same machine': {
    inline: {
      control: ['[preview]', '[release]'],
      stateViewer: ['[preview]', 'active:failed', '[release]', 'active:uploading'],
    },
    stable: {
      control: ['[preview]', '[release]'],
      stateViewer: ['[preview]', 'active:failed', '[release]', 'active:uploading'],
    },
  },
  release: {
    inline: {
      control: ['[preview]', '[replace]', 'active:uploading', '[release]'],
      stateViewer: ['[preview]', 'active:failed', '[replace]', 'active:failed', '[release]', 'active:uploading'],
    },
    stable: {
      control: ['[preview]', '[replace]', '[release]'],
      stateViewer: ['[preview]', 'active:failed', '[replace]', '[release]', 'active:uploading'],
    },
  },
  // Closing the overlay after debug.disabled turned on tells the observer nothing more.
  disable: {
    inline: {
      control: ['[preview]', '[replace]', 'active:uploading', '[disable]', '[release]'],
      stateViewer: [
        '[preview]',
        'active:failed',
        '[replace]',
        'active:failed',
        '[disable]',
        'active:uploading',
        '[release]',
      ],
    },
    stable: {
      control: ['[preview]', '[replace]', '[disable]', '[release]'],
      stateViewer: ['[preview]', 'active:failed', '[replace]', '[disable]', 'active:uploading', '[release]'],
    },
  },
  'new id': {
    inline: {
      control: ['[preview]', '[replace]', 'active:uploading', '[release]'],
      stateViewer: ['[preview]', 'active:failed', '[replace]', 'active:uploading', '[release]'],
    },
    stable: {
      control: ['[preview]', '[replace]', '[release]'],
      stateViewer: ['[preview]', 'active:failed', '[replace]', 'active:uploading', '[release]'],
    },
  },
  'release while hidden': {
    inline: {
      control: [
        '[preview]',
        '[replace]',
        'active:uploading',
        '[hide]',
        '[release]',
        '[reveal]',
        'active:uploading',
        'active:uploading',
      ],
      stateViewer: [
        '[preview]',
        'active:failed',
        '[replace]',
        'active:failed',
        '[hide]',
        '[release]',
        '[reveal]',
        'active:uploading',
        'active:uploading',
      ],
    },
    stable: {
      control: ['[preview]', '[replace]', '[hide]', '[release]', '[reveal]', 'active:uploading', 'active:uploading'],
      // One `active:uploading` more than with @xstate/react: the hook shows the observer the replaced actor's real
      // snapshot when it connects again on the reveal, in a layout effect, before @xstate/react's passive effect
      // subscribes the observer to the new actor and restarts that one (twice under StrictMode).
      stateViewer: [
        '[preview]',
        'active:failed',
        '[replace]',
        '[hide]',
        '[release]',
        '[reveal]',
        'active:uploading',
        'active:uploading',
        'active:uploading',
      ],
    },
  },
};

const Activity = (
  React as unknown as { Activity: React.ComponentType<{ mode: Mode; children: React.ReactNode }> }
).Activity;

const label = (snapshot: UploadSnapshot): string => `${snapshot.status}:${String(snapshot.value)}`;

/** What the observer heard, without the step markers. */
const heardIn = (calls: string[]): string[] => calls.filter((call) => !call.startsWith('['));

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
  /** Previews `failed` on the upload, as someone in the overlay would; only the adapter registers it. */
  async function previewFailed(): Promise<void> {
    if (previews) act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves: ['failed'] }));
    await flush();
  }

  /** Closes the overlay, ending the preview. */
  async function release(): Promise<void> {
    if (previews) act(() => registry().release());
    await flush();
  }

  type Props = { endpoint: string; id: string; disabled: boolean; mode: Mode };

  /**
   * Mounts the upload in an Activity, its machine built from the `endpoint` and `id` props, with useActorRef given an
   * inline or a stable observer that records each snapshot it hears as `status:value` in `calls`. `calls` starts empty
   * after the mount, and each step pushes a marker before it acts, so `calls` shows what the observer heard after
   * which step.
   */
  async function mountUpload(kind: Kind) {
    const calls: string[] = [];
    let actorRef: Actor<UploadMachine> | undefined;
    function Upload({ endpoint, id, disabled }: Omit<Props, 'mode'>) {
      const machine = React.useMemo(() => createUploadMachine(endpoint, id), [endpoint, id]);
      const stableObserver = useCallback((snapshot: UploadSnapshot) => {
        calls.push(label(snapshot));
      }, []);
      const inlineObserver = (snapshot: UploadSnapshot): void => {
        calls.push(label(snapshot));
      };
      actorRef = hooks.useActorRef(
        machine,
        { debug: { disabled } } as never,
        kind === 'stable' ? stableObserver : inlineObserver,
      );
      return null;
    }
    function App({ mode, ...props }: Props) {
      return (
        <Activity mode={mode}>
          <Upload {...props} />
        </Activity>
      );
    }
    const props: Props = { endpoint: '/upload', id: 'upload', disabled: false, mode: 'visible' };
    const view = render(<App {...props} />);
    const update = async (patch: Partial<Props>): Promise<void> => {
      Object.assign(props, patch);
      view.rerender(<App {...props} />);
      await flush();
    };
    await flush();
    // Under StrictMode @xstate/react starts the actor twice, and the observer hears each start.
    const mounted = calls.splice(0);
    expect(mounted).toEqual(['active:uploading', 'active:uploading']);

    return {
      calls,
      actor: (): Actor<UploadMachine> => actorRef!,
      /** The observer's last value, mount included: what state mirrored from it shows. */
      lastHeard: (): string | undefined => heardIn([...mounted, ...calls]).at(-1),
      preview: async (): Promise<void> => {
        calls.push('[preview]');
        await previewFailed();
      },
      /** The parent passes another endpoint, or a machine id too: @xstate/react replaces the actor. */
      replace: async (patch: Partial<Pick<Props, 'id'>> = {}): Promise<void> => {
        calls.push('[replace]');
        const replaced = actorRef;
        await update({ endpoint: '/v2/upload', ...patch });
        expect(actorRef).not.toBe(replaced);
      },
      release: async (): Promise<void> => {
        calls.push('[release]');
        await release();
      },
      disable: async (): Promise<void> => {
        calls.push('[disable]');
        await update({ disabled: true });
      },
      /** A tab switch hides the upload. */
      hide: async (): Promise<void> => {
        calls.push('[hide]');
        await update({ mode: 'hidden' });
      },
      /** Switching back reveals it; StrictMode replays the effects, so @xstate/react starts the actor twice. */
      reveal: async (): Promise<void> => {
        calls.push('[reveal]');
        await update({ mode: 'visible' });
      },
    };
  }

  type MountedUpload = Awaited<ReturnType<typeof mountUpload>>;

  /**
   * Checks `calls` against HEARD once nothing more is pending, and that the observer's last value is the real one, as
   * with @xstate/react.
   */
  async function expectHeard(upload: MountedUpload, scenario: Scenario, kind: Kind): Promise<void> {
    await flush();
    const heard = HEARD[scenario][kind];
    expect(upload.calls).toEqual(previews ? heard.stateViewer : heard.control);
    expect(upload.actor().getSnapshot().value).toBe('uploading');
    expect(upload.lastHeard()).toBe('active:uploading');
  }

  describe.each(OBSERVERS)('%s given to useActorRef', (_observer, kind) => {
    test('the machine stays the same: the release takes the observer out of the preview', async () => {
      const upload = await mountUpload(kind);
      await upload.preview();
      await upload.release();

      await expectHeard(upload, 'same machine', kind);
    });

    test.each(ENDS)(
      'the actor is replaced during a preview, then %s: the observer leaves the preview',
      async (_how, end) => {
        const upload = await mountUpload(kind);
        await upload.preview();
        await upload.replace();
        if (end === 'disable') await upload.disable();
        await upload.release();

        await expectHeard(upload, end, kind);
      },
    );

    test('the new machine registers under another id: the observer leaves the preview at once', async () => {
      const upload = await mountUpload(kind);
      await upload.preview();
      await upload.replace({ id: 'upload-v2' });
      await upload.release();

      await expectHeard(upload, 'new id', kind);
    });

    test(
      'the overlay is closed while an Activity hides the upload: the observer leaves the preview on the reveal',
      async () => {
        const upload = await mountUpload(kind);
        await upload.preview();
        await upload.replace();
        await upload.hide();
        await upload.release();
        if (previews) expect(registry().getSnapshot().overrides).toEqual({});
        await upload.reveal();

        await expectHeard(upload, 'release while hidden', kind);
      },
    );
  });

  test.each(ENDS)(
    'a component that mirrors the upload from a stable observer shows the real state when %s after a replacement',
    async (_how, end) => {
      function Upload({ endpoint, disabled }: { endpoint: string; disabled: boolean }) {
        const machine = React.useMemo(() => createUploadMachine(endpoint), [endpoint]);
        const [status, setStatus] = React.useState('?');
        const observer = useCallback((snapshot: UploadSnapshot) => {
          setStatus(String(snapshot.value));
        }, []);
        hooks.useActorRef(machine, { debug: { disabled } } as never, observer);
        return <p>{status}</p>;
      }
      const view = render(<Upload endpoint="/upload" disabled={false} />);
      await flush();
      expect(view.container.textContent).toBe('uploading');

      await previewFailed();
      expect(view.container.textContent).toBe(previews ? 'failed' : 'uploading');

      // The parent passes another endpoint: @xstate/react replaces the actor, and the stable observer stays with the
      // replaced one, which tells it nothing more.
      view.rerender(<Upload endpoint="/v2/upload" disabled={false} />);
      await flush();
      expect(view.container.textContent).toBe(previews ? 'failed' : 'uploading');

      if (end === 'release') {
        await release();
        expect(registry().getSnapshot().overrides).toEqual({});
      } else {
        view.rerender(<Upload endpoint="/v2/upload" disabled />);
        await flush();
      }
      await flush();

      expect(view.container.textContent).toBe('uploading');
    },
  );
});
