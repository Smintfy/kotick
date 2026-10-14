// A component mirrors its upload's state through an inline observer given to useActorRef. A preview of `failed` shows,
// and then one render both gives the hook a machine with a new config (a machine built from props; Fast Refresh of a
// module that defines the machine and the component's debug options) and turns `debug.disabled` on.
//
// @xstate/react subscribes this render's inline observer to the new actor and starts it, so the observer hears the new
// actor's real snapshot (spec §10.2: an inline observer follows the new actor; "It never hears the replaced actor's
// real snapshot and the new one's both", test/regressions/stable-observer-left-on-preview.test.tsx). Leaving the
// preview, as on a release, is decided for the observer of this render, which follows the new actor, rather than for
// the previous render's, which is still subscribed to the replaced one until the passive effects.

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createMachine, type SnapshotFrom } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

function createUploadMachine(endpoint: string) {
  return createMachine({
    id: 'upload',
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

const IMPLEMENTATIONS: [name: string, hooks: Hooks, previews: boolean][] = [
  ['@xstate/react (control)', xstateReact, false],
  ['state-viewer/xstate', stateViewer as unknown as Hooks, true],
];

/** The actor a snapshot is of, by the endpoint its machine was built for: the replaced one (old) or the new one. */
const actorOf = (snapshot: UploadSnapshot): string =>
  (snapshot.machine.config.context as { endpoint: string }).endpoint === '/upload' ? 'old' : 'new';

beforeEach(() => {
  resetRegistry();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

describe.each(IMPLEMENTATIONS)('%s', (_name, hooks, previews) => {
  test('an inline observer hears only the new actor’s real snapshot when one render replaces the actor and disables debug', async () => {
    const calls: string[] = [];
    function Upload({ endpoint, disabled }: { endpoint: string; disabled: boolean }) {
      const machine = React.useMemo(() => createUploadMachine(endpoint), [endpoint]);
      hooks.useActorRef(machine, { debug: { disabled } } as never, (snapshot: UploadSnapshot) => {
        calls.push(`${snapshot.status}:${String(snapshot.value)} (${actorOf(snapshot)})`);
      });
      return null;
    }
    const view = render(<Upload endpoint="/upload" disabled={false} />);
    await flush();
    calls.length = 0;

    calls.push('[preview]');
    if (previews) act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves: ['failed'] }));
    await flush();

    calls.push('[replace+disable]');
    view.rerender(<Upload endpoint="/v2/upload" disabled />);
    await flush();

    calls.push('[release]');
    if (previews) act(() => registry().release());
    await flush();

    expect(calls).toEqual(
      previews
        ? ['[preview]', 'active:failed (old)', '[replace+disable]', 'active:uploading (new)', '[release]']
        : ['[preview]', '[replace+disable]', 'active:uploading (new)', '[release]'],
    );
  });
});
