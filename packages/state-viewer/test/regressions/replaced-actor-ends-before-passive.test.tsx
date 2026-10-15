// The hook moves what its observer has been told (the view memory) to the new actor in the layout phase of the commit
// that replaces the actor (a machine built from a prop), but @xstate/react moves the observer itself only in that
// commit's passive effects: until then the observer is still subscribed to the replaced actor, which still runs. An
// ending the replaced actor sends in between is about the replaced actor, not the new one: the observer hears the new
// actor's previews afterwards, and the new actor's own ending is held back by a preview until the release.
//
// Here the component cancels the previous upload when the endpoint changes, from a layout effect that runs after the
// hook's (the previous upload's own socket message or timer landing in that window, which spans a task for a
// default-priority or transition commit, does the same). With @xstate/react the observer hears the cancelled upload
// end, then follows the new upload, and hears it finish once.

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fromCallback, setup, type Actor, type Observer, type SnapshotFrom } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

/** What the invoked socket of the running upload uses to report it finished, past the proxy (previews block sends). */
let finishUpload: (() => void) | undefined;

/** A machine built from the endpoint prop: a new config for each endpoint, so @xstate/react replaces the actor. */
function createUploadMachine(endpoint: string) {
  return setup({
    actors: {
      socket: fromCallback(({ sendBack }) => {
        const finish = (): void => sendBack({ type: 'UPLOADED' });
        finishUpload = finish;
        return () => {
          if (finishUpload === finish) finishUpload = undefined;
        };
      }),
    },
  }).createMachine({
    id: 'upload',
    initial: 'uploading',
    context: { endpoint },
    states: {
      uploading: { invoke: { src: 'socket' }, on: { UPLOADED: 'uploaded', CANCEL: 'cancelled' } },
      failed: {},
      uploaded: { type: 'final' },
      cancelled: { type: 'final' },
    },
  });
}

type UploadMachine = ReturnType<typeof createUploadMachine>;
type UploadSnapshot = SnapshotFrom<UploadMachine>;
type Hooks = Pick<typeof xstateReact, 'useActorRef'>;

const label = (snapshot: UploadSnapshot): string => `${snapshot.status}:${String(snapshot.value)}`;

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

describe.each([
  ['@xstate/react (control)', xstateReact as Hooks, false],
  ['state-viewer/xstate', stateViewer as unknown as Hooks, true],
] as const)('%s', (_name, hooks, previews) => {
  test('the previous upload is cancelled as the endpoint changes: the new upload’s previews and held ending reach the observer', async () => {
    const calls: string[] = [];
    let setEndpoint: (endpoint: string) => void = () => {};

    function Upload({ endpoint }: { endpoint: string }) {
      const machine = React.useMemo(() => createUploadMachine(endpoint), [endpoint]);
      const observer: Observer<UploadSnapshot> = {
        next: (snapshot) => calls.push(label(snapshot)),
        complete: () => calls.push('complete'),
      };
      const actorRef = hooks.useActorRef(machine, undefined, observer);
      // Cancels the upload to the old endpoint once the new one is in place.
      const previous = React.useRef<Actor<UploadMachine>>(actorRef);
      React.useLayoutEffect(() => {
        if (previous.current !== actorRef) previous.current.send({ type: 'CANCEL' });
        previous.current = actorRef;
      });
      return null;
    }
    function App() {
      const [endpoint, set] = React.useState('/upload');
      setEndpoint = set;
      return <Upload endpoint={endpoint} />;
    }
    render(<App />);
    await flush();
    calls.splice(0);

    calls.push('[new endpoint]');
    act(() => setEndpoint('/v2/upload'));
    await flush();

    // The developer previews `failed` on the new upload.
    calls.push('[preview]');
    if (previews) act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves: ['failed'] }));
    await flush();

    // The new upload finishes underneath the preview.
    calls.push('[finish]');
    act(() => finishUpload!());
    await flush();

    calls.push('[release]');
    if (previews) act(() => registry().release());
    await flush();

    expect(calls).toEqual(
      previews
        ? [
            '[new endpoint]', 'done:cancelled', 'complete', 'active:uploading',
            '[preview]', 'active:failed',
            // The preview carries over the live children: the finished upload's socket is gone.
            '[finish]', 'active:failed',
            '[release]', 'done:uploaded', 'complete',
          ]
        : [
            '[new endpoint]', 'done:cancelled', 'complete', 'active:uploading',
            '[preview]',
            '[finish]', 'done:uploaded', 'complete',
            '[release]',
          ],
    );
  });
});
