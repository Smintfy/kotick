import { act, render, screen } from '@testing-library/react';
import * as React from 'react';
import { useActorRef } from 'konat/xstate';
import { describe, expect, test } from 'vitest';
import { fromCallback, setup, type Observer, type SnapshotFrom } from 'xstate';
import { page } from '../support/app';
import { errorMessage, uncaught } from '../support/console';
import { describeWithActivity } from '../support/react';
import { badge, flush, freshId, preview, release, show } from '../support/panel';

type SocketEvent = { type: 'FINISH' | 'BREAK' };

type Socket = (event: SocketEvent) => void;

type Edit = 'as written' | 'without failed';

const EDITED_STATES = { 'as written': { failed: {} }, 'without failed': {} };

function createUploadMachine(
  { id, version, edit = 'as written' }: { id: string; version: string; edit?: Edit },
  realSockets: Map<string, Socket>,
) {
  return setup({
    actors: {
      socket: fromCallback<SocketEvent>(({ sendBack }) => {
        realSockets.set(version, sendBack);

        return () => {
          if (realSockets.get(version) === sendBack) realSockets.delete(version);
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
        on: { FINISH: 'uploaded', BREAK: { actions: 'crash' } },
      },
      ...EDITED_STATES[edit],
      uploaded: { type: 'final' },
    },
  });
}

type UploadMachine = ReturnType<typeof createUploadMachine>;

type UploadSnapshot = SnapshotFrom<UploadMachine>;

type Kind = 'inline' | 'stable';

const label = (snapshot: UploadSnapshot): string =>
  `${snapshot.status}:${String(snapshot.value)} (${snapshot.machine.version})`;

function observe(calls: string[]): Observer<UploadSnapshot> {
  return {
    next: (snapshot) => calls.push(label(snapshot)),
    error: (error) => calls.push(`error:${errorMessage(error)}`),
    complete: () => calls.push('complete'),
  };
}

async function mountUpload(kind: Kind) {
  const calls: string[] = [];
  const realSockets = new Map<string, Socket>();
  let machine = createUploadMachine({ id: freshId('upload'), version: 'old' }, realSockets);
  let inWindow: (() => void) | undefined;

  function Upload({ machine }: { machine: UploadMachine }) {
    const inline = observe(calls);
    const [first] = React.useState(inline);
    useActorRef(machine, undefined, kind === 'stable' ? first : inline);
    // After the hook's own layout effect, and before @xstate/react's passive effect stops the replaced actor.
    React.useLayoutEffect(() => {
      inWindow?.();
      inWindow = undefined;
    });

    return null;
  }

  const view = render(page(<Upload machine={machine} />));
  await flush();
  calls.length = 0;

  const socket = (): Socket => {
    const send = realSockets.get(String(machine.version));

    if (!send) throw new Error(`No socket runs for the ${machine.version} upload.`);

    return send;
  };

  const step = async (marker: string, run: () => void | Promise<void>): Promise<void> => {
    calls.push(marker);
    const errors = await uncaught(run);
    calls.push(...errors.map((error) => `uncaught:${errorMessage(error)}`));
  };

  return {
    calls,
    preview: async (leaf: string) => {
      // The step runs inside act(), where React 18 doesn't show a new page of the panel.
      // So the page opens first.
      await show(machine.id);
      await step(`[preview ${leaf}]`, () => preview(machine.id, [leaf]));
    },
    release: () => step('[release]', () => release(machine.id)),
    finish: () => step('[finish]', () => socket()({ type: 'FINISH' })),
    fail: () => step('[fail]', () => socket()({ type: 'BREAK' })),
    /**
     * With `report`, the socket of the replaced upload reports it in the commit that replaces it.
     * In a browser, a server message can arrive there, because React runs the passive effects after the paint.
     */
    replace: async (edit?: Edit, report?: SocketEvent['type']): Promise<void> => {
      const replaced = realSockets.get(String(machine.version));

      if (report) inWindow = () => replaced?.({ type: report });
      machine = createUploadMachine({ id: machine.id, version: 'new', edit }, realSockets);
      await step('[replace]', async () => {
        view.rerender(page(<Upload machine={machine} />));
        await flush();
      });
    },
  };
}

test.each([
  [
    'an inline observer follows the new actor: previews, the real snapshot on release, updates',
    'inline',
    [
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
  ],
  [
    "a stable observer stays with the replaced actor: none of the new actor's previews or updates",
    'stable',
    ['[replace]', '[preview failed]', '[release]', '[finish]'],
  ],
] as const)('a new machine replaces the actor while the upload runs, and the new actor is previewed: %s', async (_, kind, heard) => {
  const upload = await mountUpload(kind);

  await upload.replace();
  await upload.preview('failed');
  await upload.release();
  await upload.finish();
  expect(upload.calls).toEqual(heard);
});

describe('the actor is replaced during a preview', () => {
  test('an inline observer follows the preview onto the new actor, and leaves it on the release', async () => {
    const upload = await mountUpload('inline');

    await upload.preview('failed');
    await upload.replace();
    await upload.release();
    expect(upload.calls).toEqual([
      '[preview failed]',
      'active:failed (old)',
      '[replace]',
      'active:failed (new)',
      '[release]',
      'active:uploading (new)',
    ]);
  });

  test('a component that mirrors the upload from a stable observer shows the real state once the preview is released', async () => {
    const id = freshId('upload');
    const realSockets = new Map<string, Socket>();

    function Upload({ version }: { version: string }) {
      const machine = React.useMemo(() => createUploadMachine({ id, version }, realSockets), [version]);
      const [status, setStatus] = React.useState('?');
      const [observer] = React.useState(() => (snapshot: UploadSnapshot) => setStatus(String(snapshot.value)));
      useActorRef(machine, undefined, observer);

      return <output aria-label="upload">{status}</output>;
    }

    const status = () => screen.getByRole('status', { name: 'upload' }).textContent;
    const view = render(page(<Upload version="old" />));
    await flush();

    const mounted = status();
    await preview(id, ['failed']);
    const previewed = status();
    view.rerender(page(<Upload version="new" />));
    await flush();
    const replaced = status();
    await release(id);
    expect({ mounted, previewed, replaced, released: status() }).toEqual({
      mounted: 'uploading',
      previewed: 'failed',
      replaced: 'failed',
      released: 'uploading',
    });
  });

  test.each([
    [
      'without a preview, an inline observer hears it at once, then the new actor',
      false,
      ['[replace]', 'done:uploaded (old)', 'complete', 'active:uploading (new)'],
    ],
    [
      'during a preview, an inline observer hears it on the release, then the new actor',
      true,
      [
        '[preview failed]',
        'active:failed (old)',
        '[replace]',
        'active:failed (new)',
        '[release]',
        'done:uploaded (old)',
        'complete',
        'active:uploading (new)',
      ],
    ],
  ] as const)('the replaced upload finishes before @xstate/react stops it: %s', async (_, previewing, heard) => {
    const upload = await mountUpload('inline');

    if (previewing) await upload.preview('failed');
    await upload.replace(undefined, 'FINISH');

    if (previewing) await upload.release();
    expect(upload.calls).toEqual(heard);
  });

  test("Fast Refresh removes the previewed state: the observer hears the new actor's real snapshot once", async () => {
    const upload = await mountUpload('inline');

    await upload.preview('failed');
    await upload.replace('without failed');
    expect({ previewing: badge(), calls: upload.calls }).toEqual({
      previewing: '',
      calls: ['[preview failed]', 'active:failed (old)', '[replace]', 'active:uploading (new)'],
    });
  });
});

describe('the actor ends during a preview, and a new machine replaces it', () => {
  test.each([
    [
      'finishes',
      'finish',
      // The preview of the finished upload loses its invoked socket, so the observer hears the preview again.
      // XState repeats the ending when @xstate/react starts the new actor from the done snapshot.
      [
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
    ],
    [
      'fails',
      'fail',
      ['[fail]', '[replace]', '[release]', 'error:socket closed', 'error:socket closed', '[preview failed]', '[release]'],
    ],
  ] as const)(
    'the old actor %s: an inline observer hears the held ending after the release, and no later preview',
    async (_, ending, heard) => {
      const upload = await mountUpload('inline');
      await upload.preview('failed');
      upload.calls.length = 0;

      await upload[ending]();
      await upload.replace();
      await upload.release();
      await upload.preview('failed');
      await upload.release();
      expect(upload.calls).toEqual(heard);
    },
  );
});

const never = new Promise<never>(() => {});

// The files list suspends with use(), which React 18 doesn't have.
describeWithActivity('a render React throws away gives the hook a new machine', () => {
  // A transition stays pending while the files list suspends. A plain update shows the fallback.
  test.each<['transition' | 'plain update', string]>([
    ['transition', 'the committed view'],
    ['plain update', 'the fallback'],
  ])("a suspended %s: an inline observer follows the committed actor's previews and real updates", async (update, shows) => {
    const calls: string[] = [];
    const realSockets = new Map<string, Socket>();
    const id = freshId('upload');

    type AppState = { machine: UploadMachine; loading: boolean };

    const committed: AppState = { machine: createUploadMachine({ id, version: 'old' }, realSockets), loading: false };

    let setState: React.Dispatch<React.SetStateAction<AppState>> = () => {};

    function Upload({ machine }: { machine: UploadMachine }) {
      useActorRef(machine, undefined, observe(calls));

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
          <Upload machine={state.machine} />
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

    // The update also moves the files list to data it doesn't have, so React doesn't commit it.
    calls.push(`[${update}]`);

    const apply = (): void =>
      setState({ machine: createUploadMachine({ id, version: 'thrown away' }, realSockets), loading: true });

    await act(async () => (update === 'transition' ? React.startTransition(apply) : apply()));
    await flush();
    const shown = screen.queryByText('loading') === null ? 'the committed view' : 'the fallback';
    await step('[preview failed]', () => preview(id, ['failed']));
    await step('[release]', () => release(id));
    await step('[finish]', () => realSockets.get('old')?.({ type: 'FINISH' }));
    expect({ shown, calls }).toEqual({
      shown: shows,
      calls: [
        `[${update}]`,
        '[preview failed]',
        'active:failed (old)',
        '[release]',
        'active:uploading (old)',
        '[finish]',
        'done:uploaded (old)',
        'complete',
      ],
    });
  });
});
