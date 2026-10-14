// An observer given to useActorRef hears nothing more once it heard the actor finish, as with @xstate/react, even when
// the finished actor is previewed afterwards (spec §10.2, "Observers and the actor's ending"). Apps usually pass an
// inline observer, a new one on every render, which @xstate/react subscribes again each time: XState then only calls
// the new observer's complete, and nothing at all for a listener function. A re-render while a preview shows over the
// finished actor (a useSelector of the same actor following the preview, or a parent) doesn't hand the observer the
// previews, or the done snapshot a second time when the preview is released: the app's "on done" side effect runs once.

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { assign, createMachine, type Actor, type Observer, type SnapshotFrom } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

const uploadMachine = createMachine({
  id: 'upload',
  initial: 'uploading',
  context: { url: '' },
  states: {
    uploading: { on: { UPLOADED: { target: 'uploaded', actions: assign({ url: 'https://cdn/x.png' }) } } },
    failed: {},
    uploaded: { type: 'final' },
  },
});

type UploadSnapshot = SnapshotFrom<typeof uploadMachine>;
type UploadObserver = Observer<UploadSnapshot> | ((snapshot: UploadSnapshot) => void);
type Hooks = Pick<typeof xstateReact, 'useActorRef' | 'useSelector'>;

const IMPLEMENTATIONS: [name: string, hooks: Hooks, previews: boolean][] = [
  ['@xstate/react (control)', xstateReact, false],
  ['state-viewer/xstate', stateViewer as unknown as Hooks, true],
];

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
   * Mounts a component that passes a new observer to useActorRef on every render and reads the actor with
   * useSelector, then finishes the upload with no preview showing.
   */
  async function mountAndFinish(makeObserver: () => UploadObserver) {
    let actorRef: Actor<typeof uploadMachine> | undefined;
    function Upload() {
      const ref = hooks.useActorRef(uploadMachine, undefined, makeObserver());
      actorRef = ref;
      const value = hooks.useSelector(ref, (snapshot) => String(snapshot.value));
      return <p>{value}</p>;
    }
    const view = render(<Upload />);
    await flush();
    act(() => actorRef?.send({ type: 'UPLOADED' }));
    await flush();
    return view;
  }

  /** Someone looks at two states of the finished upload in the overlay, then closes it. */
  async function lookAround(): Promise<void> {
    if (previews) act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves: ['failed'] }));
    await flush();
    if (previews) act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves: ['uploading'] }));
    await flush();
    if (previews) act(() => registry().release());
    await flush();
  }

  test('an inline listener hears nothing more once it heard the upload finish', async () => {
    const heard: string[] = [];
    const view = await mountAndFinish(() => (snapshot) => heard.push(`${snapshot.status}:${String(snapshot.value)}`));
    expect(heard.at(-1)).toBe('done:uploaded');
    const ended = [...heard];

    await lookAround();

    expect(view.container.textContent).toBe('uploaded');
    expect(heard.slice(ended.length)).toEqual([]);
  });

  test('an inline observer object gets the done snapshot only once', async () => {
    const calls: string[] = [];
    await mountAndFinish(() => ({
      next: (snapshot) => calls.push(`next:${snapshot.status}:${String(snapshot.value)}`),
      complete: () => calls.push('complete'),
    }));
    expect(calls.filter((call) => call === 'next:done:uploaded')).toEqual(['next:done:uploaded']);

    await lookAround();

    // @xstate/react calls complete again whenever it subscribes a new observer to the finished actor; no snapshot
    // reaches next once the actor is done.
    expect(calls.filter((call) => call.startsWith('next:')).at(-1)).toBe('next:done:uploaded');
    expect(calls.filter((call) => call === 'next:done:uploaded')).toEqual(['next:done:uploaded']);
  });
});

describe('a parent re-rendering the component while a preview shows over the finished actor', () => {
  /**
   * Finishes the upload, previews a state, re-renders the component from its parent, and releases the preview.
   * Returns what the listener heard after it heard the upload finish.
   */
  async function rerenderDuringPreview(
    heard: string[],
    makeListener: () => (snapshot: UploadSnapshot) => void,
  ): Promise<string[]> {
    let actorRef: Actor<typeof uploadMachine> | undefined;
    function Upload({ hint }: { hint: string }) {
      actorRef = stateViewer.useActorRef(uploadMachine, undefined, makeListener());
      return <p>{hint}</p>;
    }
    const { rerender } = render(<Upload hint="a" />);
    await flush();
    act(() => actorRef?.send({ type: 'UPLOADED' }));
    await flush();
    expect(heard.at(-1)).toBe('done:uploaded');
    const ended = heard.length;

    act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves: ['failed'] }));
    await flush();
    rerender(<Upload hint="b" />);
    await flush();
    act(() => registry().release());
    await flush();
    return heard.slice(ended);
  }

  test('passes nothing more to an inline listener', async () => {
    const heard: string[] = [];
    const after = await rerenderDuringPreview(heard, () => (snapshot) => {
      heard.push(`${snapshot.status}:${String(snapshot.value)}`);
    });

    expect(after).toEqual([]);
  });

  test('passes nothing more to a stable listener', async () => {
    const heard: string[] = [];
    const listener = (snapshot: UploadSnapshot) => heard.push(`${snapshot.status}:${String(snapshot.value)}`);
    const after = await rerenderDuringPreview(heard, () => listener);

    expect(after).toEqual([]);
  });
});
