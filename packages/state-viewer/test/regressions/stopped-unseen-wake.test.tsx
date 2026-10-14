// A consumer that only re-renders (the hooks' store, useSelector) is woken to leave a preview of an actor that stopped
// (spec §10.2, "Observers and the actor's ending"; R10, R13), including one that subscribed after the stop, which XState
// tells nothing. useMachine and useActor subscribe after the stop when Fast Refresh (a new logic.config) gives the hook a
// new actor after the app stopped the old one during a preview: @xstate/react restores the stopped snapshot into it. A
// useSelector consumer does when it mounts after the app stopped the actor during a preview (the "Cancelled" panel the
// Cancel button that stopped it shows). Such a consumer may have rendered the preview, so it stays subscribed while the
// preview shows, whatever leaf it moves to, and once the preview is released it shows the real, stopped snapshot, as
// with @xstate/react, and agrees with a consumer that subscribed before the stop. A consumer that subscribed to the
// stopped actor with no preview showing already shows the real snapshot, and hears no later preview: previews of a
// stopped hook actor reach no subscriber.

import { act, render, screen } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createMachine, type AnyActorRef } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

/** A fresh machine object from a fresh config object each call, the way Fast Refresh re-evaluates a module. */
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
const uploadMachine = createUploadMachine();
type Hooks = Pick<typeof xstateReact, 'useMachine' | 'useActorRef' | 'useSelector'>;

const IMPLEMENTATIONS: [name: string, hooks: Hooks, previews: boolean][] = [
  ['@xstate/react (control)', xstateReact, false],
  ['state-viewer/xstate', stateViewer as unknown as Hooks, true],
];

const label = (snapshot: { status: string; value: unknown }): string => `${snapshot.status}:${String(snapshot.value)}`;

/** What a consumer renders, and what the actor it reads returns from getSnapshot(). */
interface Shown {
  rendered: string | null;
  actor: string;
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
  function preview(leaves: string[]): void {
    if (previews) act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves }));
  }

  function release(): void {
    if (previews) act(() => registry().release());
  }

  /**
   * Mounts an upload read with useMachine, previews `failed`, stops the real actor underneath (the user cancels), and
   * edits the machine (Fast Refresh), which gives the hook a new actor.
   */
  async function fastRefreshAfterStop(): Promise<() => Shown> {
    let actorRef: AnyActorRef | undefined;
    function Upload({ machine }: { machine: UploadMachine }) {
      const [snapshot, , ref] = hooks.useMachine(machine);
      actorRef = ref;
      return <output data-testid="consumer">{label(snapshot)}</output>;
    }
    const { rerender } = render(<Upload machine={createUploadMachine()} />);
    await flush();

    preview(['failed']);
    await flush();
    act(() => {
      actorRef!.stop();
    });
    await flush();
    rerender(<Upload machine={createUploadMachine()} />);
    await flush();
    return () => ({ rendered: screen.getByTestId('consumer').textContent, actor: label(actorRef!.getSnapshot()) });
  }

  /**
   * Mounts an upload made with useActorRef, previews `failed`, stops the real actor underneath (the user cancels), and
   * mounts a panel reading the stopped actor with useSelector.
   */
  async function mountSelectorAfterStop(): Promise<() => Shown> {
    let actorRef: AnyActorRef | undefined;
    function Cancelled({ upload }: { upload: AnyActorRef }) {
      const shown = hooks.useSelector(upload, label);
      return <output data-testid="consumer">{shown}</output>;
    }
    function Upload({ cancelled }: { cancelled: boolean }) {
      actorRef = hooks.useActorRef(uploadMachine);
      return cancelled ? <Cancelled upload={actorRef} /> : null;
    }
    const { rerender } = render(<Upload cancelled={false} />);
    await flush();

    preview(['failed']);
    await flush();
    act(() => {
      actorRef!.stop();
    });
    await flush();
    rerender(<Upload cancelled />);
    await flush();
    return () => ({ rendered: screen.getByTestId('consumer').textContent, actor: label(actorRef!.getSnapshot()) });
  }

  describe.each<[consumer: string, stopThenSubscribe: () => Promise<() => Shown>]>([
    ['useMachine, given a new actor by Fast Refresh after the stop during a preview', fastRefreshAfterStop],
    ['a useSelector consumer mounted after the stop during a preview', mountSelectorAfterStop],
  ])('%s', (_consumer, stopThenSubscribe) => {
    test('shows the real, stopped snapshot once the preview is released', async () => {
      const shown = await stopThenSubscribe();

      release();
      await flush();

      expect(shown()).toEqual({ rendered: 'stopped:uploading', actor: 'stopped:uploading' });
    });

    test('shows the real, stopped snapshot once the preview is released, after it moved to another leaf', async () => {
      const shown = await stopThenSubscribe();

      preview(['uploaded']);
      await flush();
      preview(['uploading']);
      await flush();
      release();
      await flush();

      expect(shown()).toEqual({ rendered: 'stopped:uploading', actor: 'stopped:uploading' });
    });
  });

  test('a useSelector consumer mounted after the stop with no preview showing hears no later preview', async () => {
    let actorRef: AnyActorRef | undefined;
    // Memoized, as context consumers and list rows often are, so it only re-renders when its own subscription says so.
    const Reader = React.memo(function Reader({ upload, id }: { upload: AnyActorRef; id: string }) {
      const shown = hooks.useSelector(upload, label);
      return <output data-testid={id}>{shown}</output>;
    });
    function Upload({ cancelled }: { cancelled: boolean }) {
      actorRef = hooks.useActorRef(uploadMachine);
      return (
        <>
          <Reader upload={actorRef} id="before" />
          {cancelled ? <Reader upload={actorRef} id="after" /> : null}
        </>
      );
    }
    const shown = () => ({
      before: screen.getByTestId('before').textContent,
      after: screen.getByTestId('after').textContent,
    });
    const { rerender } = render(<Upload cancelled={false} />);
    await flush();
    act(() => {
      actorRef!.stop();
    });
    await flush();
    rerender(<Upload cancelled />);
    await flush();

    preview(['failed']);
    await flush();
    // A consumer subscribed before the stop isn't told about it, as with @xstate/react, and follows no preview either.
    expect(shown()).toEqual({ before: 'active:uploading', after: 'stopped:uploading' });

    release();
    await flush();
    expect(shown()).toEqual({ before: 'active:uploading', after: 'stopped:uploading' });
  });
});

describe('state-viewer/xstate: useSelector consumers subscribed before and after the stop', () => {
  let actorRef: AnyActorRef | undefined;

  // Memoized, as context consumers and list rows often are, so it only re-renders when its own subscription says so.
  const Reader = React.memo(function Reader({ upload, id }: { upload: AnyActorRef; id: string }) {
    const shown = stateViewer.useSelector(upload, label);
    return <output data-testid={id}>{shown}</output>;
  });

  function Upload({ cancelled }: { cancelled: boolean }) {
    actorRef = stateViewer.useActorRef(uploadMachine);
    return (
      <>
        <Reader upload={actorRef} id="before" />
        {cancelled ? <Reader upload={actorRef} id="after" /> : null}
      </>
    );
  }

  const shown = () => ({
    before: screen.getByTestId('before').textContent,
    after: screen.getByTestId('after').textContent,
  });

  test('agree on the real, stopped snapshot once a preview the actor stopped under is released', async () => {
    const { rerender } = render(<Upload cancelled={false} />);
    await flush();
    act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves: ['failed'] }));
    await flush();
    act(() => {
      actorRef!.stop();
    });
    await flush();
    rerender(<Upload cancelled />);
    await flush();
    expect(shown()).toEqual({ before: 'active:failed', after: 'active:failed' });

    act(() => registry().release());
    await flush();
    expect(shown()).toEqual({ before: 'stopped:uploading', after: 'stopped:uploading' });
  });

  test('one mounted under a preview applied after the stop shows the real, stopped snapshot once it is released', async () => {
    const { rerender } = render(<Upload cancelled={false} />);
    await flush();
    act(() => {
      actorRef!.stop();
    });
    await flush();
    act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves: ['failed'] }));
    await flush();
    rerender(<Upload cancelled />);
    await flush();
    // The new consumer renders what the proxy shows; the one subscribed before the stop follows no preview.
    expect(shown()).toEqual({ before: 'active:uploading', after: 'active:failed' });

    act(() => registry().release());
    await flush();
    expect(shown()).toEqual({ before: 'active:uploading', after: 'stopped:uploading' });
  });
});
