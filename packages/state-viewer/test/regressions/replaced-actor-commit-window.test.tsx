// What the actor a new config replaced (a machine built from a prop) still sends the hook's observer between the
// layout phase of the commit that replaces it and that commit's passive effects, where @xstate/react moves an inline
// observer to the new actor and stops the old one (a stable observer stays subscribed to the old one, which then tells
// it nothing). Here the old upload's socket reports in that window, from a layout effect of the component, as its own
// message landing there would.
//
// - An update of the old actor while a preview is on is held back, as the preview hides real updates (R13): an
//   inline observer, which follows the new actor, never hears it; a stable one, which stays with the old actor, hears
//   its real snapshot when the preview ends (test/regressions/stable-observer-left-on-preview.test.tsx).
// - The old actor failing is about the old actor: the observer hears the error, and still hears the new actor's
//   previews, which it would not once told the new actor ended (spec §10.2, "Observers and the actor's ending").

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fromCallback, setup, type Actor, type Observer, type SnapshotFrom } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

/** What each running upload's invoked socket reports through, by endpoint, past the proxy (previews block sends). */
const sockets = new Map<string, (event: { type: 'PAUSE' | 'BREAK' | 'FINISH' }) => void>();

function createUploadMachine(endpoint: string) {
  return setup({
    actors: {
      socket: fromCallback<{ type: 'PAUSE' | 'BREAK' | 'FINISH' }, { endpoint: string }>(({ sendBack, input }) => {
        sockets.set(input.endpoint, sendBack);
        return () => sockets.delete(input.endpoint);
      }),
    },
  }).createMachine({
    id: 'upload',
    initial: 'uploading',
    context: { endpoint },
    states: {
      uploading: {
        invoke: { src: 'socket', input: ({ context }) => ({ endpoint: context.endpoint }) },
        on: {
          PAUSE: 'paused',
          FINISH: 'uploaded',
          BREAK: {
            actions: () => {
              throw new Error('socket closed');
            },
          },
        },
      },
      paused: {},
      failed: {},
      uploaded: { type: 'final' },
    },
  });
}

type UploadMachine = ReturnType<typeof createUploadMachine>;
type UploadSnapshot = SnapshotFrom<UploadMachine>;
type Hooks = Pick<typeof xstateReact, 'useActorRef'>;

/** The actor a snapshot is of, by the endpoint its machine was built for: the replaced one (old) or the new one. */
const actorOf = (snapshot: UploadSnapshot): string =>
  (snapshot.machine.config.context as { endpoint: string }).endpoint === '/upload' ? 'old' : 'new';
const label = (snapshot: UploadSnapshot): string => `${snapshot.status}:${String(snapshot.value)} (${actorOf(snapshot)})`;

beforeEach(() => {
  resetRegistry();
  sockets.clear();
  // Previews of states without a recording or fixture warn about falling back to live context.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

/**
 * Renders an upload whose endpoint changes on `[replace]`; the old upload's socket sends `event` in a layout effect.
 * The observer is `stableObserver` itself, or a copy made on each render (inline).
 */
function setupUpload(
  hooks: Hooks,
  calls: string[],
  event: 'PAUSE' | 'BREAK' | 'FINISH',
  stable: boolean,
  stableObserver: Observer<UploadSnapshot> = {
    next: (snapshot) => calls.push(label(snapshot)),
    error: (error) => calls.push(`error: ${(error as Error).message}`),
  },
) {
  let setEndpoint: (endpoint: string) => void = () => {};
  let first: Actor<UploadMachine> | undefined;
  function Upload({ endpoint }: { endpoint: string }) {
    const machine = React.useMemo(() => createUploadMachine(endpoint), [endpoint]);
    const observer: Observer<UploadSnapshot> = stable ? stableObserver : { ...stableObserver };
    const actorRef = hooks.useActorRef(machine, undefined, observer) as Actor<UploadMachine>;
    // The first committed actor: React 18's StrictMode throws away the first render, and the actor it made.
    React.useLayoutEffect(() => {
      first ??= actorRef;
    });
    // The old upload's socket reports once the new upload is in place.
    const previous = React.useRef(endpoint);
    React.useLayoutEffect(() => {
      if (previous.current !== endpoint) sockets.get(previous.current)?.({ type: event });
      previous.current = endpoint;
    });
    return null;
  }
  function App() {
    const [endpoint, set] = React.useState('/upload');
    setEndpoint = set;
    return <Upload endpoint={endpoint} />;
  }
  render(<App />);
  return { replace: () => act(() => setEndpoint('/v2/upload')), first: () => first! };
}

describe.each([
  ['@xstate/react (control)', xstateReact as Hooks, false],
  ['state-viewer/xstate', stateViewer as unknown as Hooks, true],
] as const)('%s', (_name, hooks, previews) => {
  test('an inline observer never hears an update the old actor makes under a preview', async () => {
    const calls: string[] = [];
    const upload = setupUpload(hooks, calls, 'PAUSE', false);
    await flush();
    calls.splice(0);

    calls.push('[preview]');
    if (previews) act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves: ['failed'] }));
    await flush();

    calls.push('[replace]');
    upload.replace();
    await flush();

    calls.push('[release]');
    if (previews) act(() => registry().release());
    await flush();

    expect(calls).toEqual(
      previews
        ? // The new actor's preview once at the replacement (§10.2).
          ['[preview]', 'active:failed (old)', '[replace]', 'active:failed (new)', '[release]', 'active:uploading (new)']
        : ['[preview]', '[replace]', 'active:paused (old)', 'active:uploading (new)', '[release]'],
    );
  });

  test('a stable observer hears the update the old actor made under a preview when the preview ends', async () => {
    const calls: string[] = [];
    const upload = setupUpload(hooks, calls, 'PAUSE', true);
    await flush();
    calls.splice(0);

    calls.push('[preview]');
    if (previews) act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves: ['failed'] }));
    await flush();

    calls.push('[replace]');
    upload.replace();
    await flush();

    calls.push('[release]');
    if (previews) act(() => registry().release());
    await flush();

    expect(calls).toEqual(
      previews
        ? ['[preview]', 'active:failed (old)', '[replace]', '[release]', 'active:paused (old)']
        : ['[preview]', '[replace]', 'active:paused (old)', '[release]'],
    );
  });

  test('an observer that hears the old actor fail still hears the new actor’s previews', async () => {
    const calls: string[] = [];
    const upload = setupUpload(hooks, calls, 'BREAK', false);
    await flush();
    calls.splice(0);

    calls.push('[replace]');
    upload.replace();
    await flush();

    calls.push('[preview]');
    if (previews) act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves: ['failed'] }));
    await flush();

    calls.push('[release]');
    if (previews) act(() => registry().release());
    await flush();

    expect(calls).toEqual(
      previews
        ? [
            '[replace]', 'error: socket closed', 'active:uploading (new)',
            '[preview]', 'active:failed (new)',
            '[release]', 'active:uploading (new)',
          ]
        : ['[replace]', 'error: socket closed', 'active:uploading (new)', '[preview]', '[release]'],
    );
  });
  test('an inline observer hears the old actor finish under a preview when the preview ends, before the new actor', async () => {
    const calls: string[] = [];
    const upload = setupUpload(hooks, calls, 'FINISH', false, {
      next: (snapshot) => calls.push(label(snapshot)),
      complete: () => calls.push('complete'),
    });
    await flush();
    calls.splice(0);

    calls.push('[preview]');
    if (previews) act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves: ['failed'] }));
    await flush();

    calls.push('[replace]');
    upload.replace();
    await flush();

    calls.push('[release]');
    if (previews) act(() => registry().release());
    await flush();

    expect(calls).toEqual(
      previews
        ? [
            '[preview]', 'active:failed (old)',
            '[replace]', 'active:failed (new)',
            '[release]', 'done:uploaded (old)', 'complete', 'active:uploading (new)',
          ]
        : ['[preview]', '[replace]', 'done:uploaded (old)', 'complete', 'active:uploading (new)', '[release]'],
    );
  });

  test('an observer without next reads the old actor’s output through its proxy as it hears it finish', async () => {
    const calls: string[] = [];
    const upload = setupUpload(hooks, calls, 'FINISH', true, {
      complete: () => calls.push(`complete: ${String(upload.first().getSnapshot().value)}`),
    });
    await flush();

    calls.push('[preview]');
    if (previews) act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves: ['failed'] }));
    await flush();

    calls.push('[replace]');
    upload.replace();
    await flush();

    expect(calls).toEqual(['[preview]', '[replace]', 'complete: uploaded']);
  });
});
