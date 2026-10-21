import { act, render, screen } from '@testing-library/react';
import * as React from 'react';
import { connect, useActor, useActorRef, useMachine, useSelector } from 'state-viewer/xstate';
import { describe, expect, test } from 'vitest';
import { createActor, createMachine, type AnyActorRef, type Observer, type SnapshotFrom } from 'xstate';
import { page, press } from '../support/app';
import { describeWithActivity, IMPLEMENTATIONS, type Hooks } from '../support/hooks';
import {
  badge,
  clickLeaf,
  flush,
  freshId,
  instances,
  machines,
  panel,
  preview,
  release,
  releaseAll,
} from '../support/panel';

/** Makes the upload machine. Called again with the same id, it makes a new machine, as Fast Refresh does. */
function createUploadMachine(id = freshId('upload')) {
  return createMachine({
    id,
    initial: 'uploading',
    states: {
      uploading: { on: { UPLOADED: 'uploaded' } },
      failed: {},
      paused: {},
      uploaded: { type: 'final' },
    },
  });
}

type UploadMachine = ReturnType<typeof createUploadMachine>;

type UploadSnapshot = SnapshotFrom<UploadMachine>;

/** What a consumer shows of a snapshot, as `status:value`. */
function label(snapshot: { status: string; value: unknown }): string {
  return `${snapshot.status}:${String(snapshot.value)}`;
}

function shown(name: string): string | null {
  return screen.getByRole('status', { name }).textContent;
}

/** Clicks Cancel, which stops the actor as an app does. stop() is not an event, so a preview doesn't block it. */
async function cancel(): Promise<void> {
  await press('Cancel');
}

// Memoized, as context consumers and list rows often are, so it renders again only when its own subscription says so.
const Reader = React.memo(function Reader({ upload, name }: { upload: AnyActorRef; name: string }) {
  return <output aria-label={name}>{useSelector(upload, label)}</output>;
});

/** The upload as useMachine or useActor shows it, and as a useSelector consumer of its actor shows it. */
function Upload({ machine, useHook = useMachine }: { machine: UploadMachine; useHook?: typeof useMachine }) {
  const [snapshot, , actorRef] = useHook(machine);

  return (
    <>
      <output aria-label="upload">{label(snapshot)}</output>
      <Reader upload={actorRef} name="reader" />
      <button type="button" onClick={() => actorRef.stop()}>
        Cancel
      </button>
    </>
  );
}

function both() {
  return { upload: shown('upload'), reader: shown('reader') };
}

function beforeAndAfter() {
  return { before: shown('before'), after: shown('after') };
}

/** An upload that useActorRef runs, with a useSelector consumer named after each of `readers`. */
function Cancellable({
  machine,
  readers,
  useHook = useActorRef,
}: {
  machine: UploadMachine;
  readers: string[];
  useHook?: Hooks['useActorRef'];
}) {
  const actorRef = useHook(machine);

  return (
    <>
      {readers.map((name) => (
        <Reader key={name} upload={actorRef} name={name} />
      ))}
      <button type="button" onClick={() => actorRef.stop()}>
        Cancel
      </button>
    </>
  );
}

/** An observer that logs each call it gets, tagged with `tag()`, so the log tells which render's observer heard it. */
function logTo(calls: string[], tag: () => string): Observer<UploadSnapshot> {
  return {
    next: (snapshot) => calls.push(`${tag()}: next ${label(snapshot)}`),
    complete: () => calls.push(`${tag()}: complete`),
  };
}

/** A new observer on every render, as apps usually write it, or the first render's throughout. */
const OBSERVERS: [name: string, stable: boolean][] = [
  ['an inline observer', false],
  ['a stable observer', true],
];

function useObserver(observer: Observer<UploadSnapshot>, stable: boolean): Observer<UploadSnapshot> {
  const [first] = React.useState(observer);

  return stable ? first : observer;
}

test('the app stops the actor during a preview, and the release shows its real, stopped snapshot in the component and in a useSelector consumer', async () => {
  const machine = createUploadMachine();
  render(page(<Upload machine={machine} />));
  await flush();

  await preview(machine.id, ['failed']);
  const previewed = both();
  await cancel();
  const stopped = both();
  await release(machine.id);
  expect({ previewed, stopped, released: both() }).toEqual({
    previewed: { upload: 'active:failed', reader: 'active:failed' },
    stopped: { upload: 'active:failed', reader: 'active:failed' },
    released: { upload: 'stopped:uploading', reader: 'stopped:uploading' },
  });
});

describe('a connected actor read with useSelector, stopped during a preview', () => {
  test('shows the real, stopped snapshot once the registry drops the preview', async () => {
    const machine = createUploadMachine();
    const upload = connect(createActor(machine).start());
    render(page(<Reader upload={upload} name="reader" />));
    await flush();

    await preview(machine.id, ['failed']);
    const previewed = { reader: shown('reader'), previewing: badge() };
    await act(async () => {
      upload.stop();
    });
    expect({ previewed, stopped: { reader: shown('reader'), previewing: badge() } }).toEqual({
      previewed: { reader: 'active:failed', previewing: '1' },
      stopped: { reader: 'stopped:uploading', previewing: '' },
    });
  });
});

describe('a hook actor the app stopped', () => {
  test('nothing previews the hook or a useSelector consumer after a stop during a preview, though the hook keeps the stopped actor listed', async () => {
    const machine = createUploadMachine();
    render(page(<Upload machine={machine} />));
    await flush();
    await preview(machine.id, ['failed']);
    await cancel();
    await release(machine.id);

    await preview(machine.id, ['paused']);
    const later = { shown: both(), instances: instances(), previewed: panel().previewed };
    await release(machine.id);
    expect({ later, released: both() }).toEqual({
      later: {
        shown: { upload: 'stopped:uploading', reader: 'stopped:uploading' },
        instances: [`${machine.id} · 1`],
        previewed: ['paused'],
      },
      released: { upload: 'stopped:uploading', reader: 'stopped:uploading' },
    });
  });

  test.each([
    ['useMachine', useMachine],
    ['useActor', useActor as typeof useMachine],
  ])('after the app stops the actor of %s, neither it nor a useSelector consumer of its actor shows a preview', async (_, useHook) => {
    const machine = createUploadMachine();
    render(page(<Upload machine={machine} useHook={useHook} />));
    await flush();
    await cancel();

    await preview(machine.id, ['failed']);
    const previewing = { shown: both(), previewed: panel().previewed };
    await release(machine.id);
    // XState tells neither of the stop, as with @xstate/react, so both keep what they rendered before it.
    expect({ previewing, released: both() }).toEqual({
      previewing: { shown: { upload: 'active:uploading', reader: 'active:uploading' }, previewed: ['failed'] },
      released: { upload: 'active:uploading', reader: 'active:uploading' },
    });
  });
});

describe.each(IMPLEMENTATIONS)('a consumer that subscribes after the stop, like @xstate/react, with %s', (_, hooks, previews) => {
  /** Previews `failed`, cancels, and edits the machine, as Fast Refresh does, which gives useMachine a new actor. */
  async function fastRefreshAfterStop(): Promise<{ id: string; consumer: string }> {
    const id = freshId('upload');

    function FastRefreshed({ machine }: { machine: UploadMachine }) {
      const [snapshot, , actorRef] = hooks.useMachine(machine);

      return (
        <>
          <output aria-label="upload">{label(snapshot)}</output>
          <button type="button" onClick={() => actorRef.stop()}>
            Cancel
          </button>
        </>
      );
    }

    const view = render(page(<FastRefreshed machine={createUploadMachine(id)} />));
    await flush();

    if (previews) await preview(id, ['failed']);
    await cancel();
    view.rerender(page(<FastRefreshed machine={createUploadMachine(id)} />));
    await flush();

    return { id, consumer: 'upload' };
  }

  /** Previews `failed`, cancels, and mounts a Cancelled panel that reads the stopped actor with useSelector. */
  async function mountReaderAfterStop(): Promise<{ id: string; consumer: string }> {
    const machine = createUploadMachine();
    const view = render(page(<Cancellable machine={machine} readers={[]} useHook={hooks.useActorRef} />));
    await flush();

    if (previews) await preview(machine.id, ['failed']);
    await cancel();
    view.rerender(page(<Cancellable machine={machine} readers={['cancelled']} useHook={hooks.useActorRef} />));
    await flush();

    return { id: machine.id, consumer: 'cancelled' };
  }

  describe.each([
    ['useMachine, given a new actor by Fast Refresh after the stop during a preview', fastRefreshAfterStop],
    ['a useSelector consumer mounted after the stop during a preview', mountReaderAfterStop],
  ])('%s', (_, stopThenSubscribe) => {
    test('shows the real, stopped snapshot once the preview is released', async () => {
      const { id, consumer } = await stopThenSubscribe();

      if (previews) await release(id);
      expect(shown(consumer)).toEqual('stopped:uploading');
    });

    test('shows the real, stopped snapshot once the preview is released, after it moved to another leaf', async () => {
      const { id, consumer } = await stopThenSubscribe();

      if (previews) {
        await clickLeaf('uploaded');
        await clickLeaf('uploading');
        await release(id);
      }

      expect(shown(consumer)).toEqual('stopped:uploading');
    });
  });

  test('a useSelector consumer mounted after the stop with no preview showing hears no later preview', async () => {
    const machine = createUploadMachine();

    const app = (readers: string[]) =>
      page(<Cancellable machine={machine} readers={readers} useHook={hooks.useActorRef} />);

    const view = render(app(['before']));
    await flush();
    await cancel();
    view.rerender(app(['before', 'after']));
    await flush();

    if (previews) await preview(machine.id, ['failed']);
    const previewing = beforeAndAfter();

    if (previews) await release(machine.id);
    // A consumer subscribed before the stop isn't told about it, as with @xstate/react, and follows no preview either.
    expect({ previewing, released: beforeAndAfter() }).toEqual({
      previewing: { before: 'active:uploading', after: 'stopped:uploading' },
      released: { before: 'active:uploading', after: 'stopped:uploading' },
    });
  });
});

describe('useSelector consumers subscribed before and after the stop', () => {
  const app = (machine: UploadMachine, readers: string[]) => page(<Cancellable machine={machine} readers={readers} />);

  test('agree on the real, stopped snapshot once a preview the actor stopped under is released', async () => {
    const machine = createUploadMachine();
    const view = render(app(machine, ['before']));
    await flush();
    await preview(machine.id, ['failed']);
    await cancel();
    view.rerender(app(machine, ['before', 'after']));
    await flush();

    const previewing = beforeAndAfter();
    await release(machine.id);
    expect({ previewing, released: beforeAndAfter() }).toEqual({
      previewing: { before: 'active:failed', after: 'active:failed' },
      released: { before: 'stopped:uploading', after: 'stopped:uploading' },
    });
  });

  test('one mounted under a preview applied after the stop shows the real, stopped snapshot once it is released', async () => {
    const machine = createUploadMachine();
    const view = render(app(machine, ['before']));
    await flush();
    await cancel();
    await preview(machine.id, ['failed']);
    view.rerender(app(machine, ['before', 'after']));
    await flush();

    const previewing = beforeAndAfter();
    await release(machine.id);
    // The new consumer renders what the actor shows. The one subscribed before the stop follows no preview.
    expect({ previewing, released: beforeAndAfter() }).toEqual({
      previewing: { before: 'active:uploading', after: 'active:failed' },
      released: { before: 'active:uploading', after: 'stopped:uploading' },
    });
  });
});

describe.each(IMPLEMENTATIONS)('the observer given to useActorRef, when the app stops the actor during a preview, like @xstate/react, with %s', (_, hooks, previews) => {
  describe.each(OBSERVERS)('%s', (_, stable) => {
    /**
     * Renders an upload whose observer is tagged with the hint its parent passed, previews `failed`, and cancels.
     * `calls` logs from the cancel on.
     * Returns the machine, and a render of the parent with a new hint.
     */
    async function cancelDuringPreview(calls: string[]) {
      const machine = createUploadMachine();

      function Hinted({ hint }: { hint: string }) {
        const actorRef = hooks.useActorRef(machine, undefined, useObserver(logTo(calls, () => hint), stable));

        return (
          <button type="button" onClick={() => actorRef.stop()}>
            Cancel
          </button>
        );
      }

      const view = render(page(<Hinted hint="Uploading" />));
      await flush();

      if (previews) await preview(machine.id, ['failed']);

      calls.length = 0;
      calls.push('[app stops]');
      await cancel();

      const rerender = async (hint: string) => {
        view.rerender(page(<Hinted hint={hint} />));
        await flush();
      };

      return { machine, rerender };
    }

    /** After the release: the parent renders the component again, and the developer looks at another state. */
    async function afterwards(calls: string[], machine: UploadMachine, rerender: (hint: string) => Promise<void>) {
      calls.push('[afterwards]');
      await rerender('Closed');

      if (previews) {
        await preview(machine.id, ['uploaded']);
        await release(machine.id);
      }
    }

    test('hears complete once when the app stops the actor during a preview', async () => {
      const calls: string[] = [];
      const { machine, rerender } = await cancelDuringPreview(calls);
      calls.push('[release]');

      if (previews) await release(machine.id);
      await afterwards(calls, machine, rerender);

      expect(calls).toEqual(
        previews
          ? ['[app stops]', '[release]', 'Uploading: complete', '[afterwards]']
          : ['[app stops]', 'Uploading: complete', '[release]', '[afterwards]'],
      );
    });

    test('hears complete once when, after the app stops the actor, a parent re-renders the component before the release', async () => {
      const calls: string[] = [];
      const { machine, rerender } = await cancelDuringPreview(calls);
      calls.push('[parent re-renders]');
      await rerender('Cancelled');
      calls.push('[release]');

      if (previews) await release(machine.id);
      await afterwards(calls, machine, rerender);

      expect(calls).toEqual(
        previews
          ? [
              '[app stops]',
              '[parent re-renders]',
              '[release]',
              // By then @xstate/react has subscribed the observer of the new render, unless the observer is stable.
              `${stable ? 'Uploading' : 'Cancelled'}: complete`,
              '[afterwards]',
            ]
          : ['[app stops]', 'Uploading: complete', '[parent re-renders]', '[release]', '[afterwards]'],
      );
    });

    test('hears complete once when, after the app stops the actor, a useSelector re-renders the component on another preview before the release', async () => {
      const machine = createUploadMachine();
      const calls: string[] = [];

      function Followed() {
        // What this render shows, set below. The observer reads it when it is called.
        let value = '';
        const actorRef = hooks.useActorRef(machine, undefined, useObserver(logTo(calls, () => value), stable));
        value = hooks.useSelector(actorRef, (snapshot) => String(snapshot.value));

        return (
          <>
            <output aria-label="upload">{value}</output>
            <button type="button" onClick={() => actorRef.stop()}>
              Cancel
            </button>
          </>
        );
      }

      render(page(<Followed />));
      await flush();

      if (previews) await preview(machine.id, ['failed']);

      calls.length = 0;
      calls.push('[app stops]');
      await cancel();
      // The developer clicks another state: useSelector renders the component again, which passes a new observer.
      calls.push('[preview of uploaded]');

      if (previews) await clickLeaf('uploaded');
      const moved = shown('upload');
      calls.push('[release]');

      if (previews) await release(machine.id);
      calls.push('[afterwards]');

      if (previews) {
        await preview(machine.id, ['failed']);
        await release(machine.id);
      }

      expect({ moved, released: shown('upload'), calls }).toEqual({
        moved: previews ? 'uploaded' : 'uploading',
        released: 'uploading',
        calls: previews
          ? [
              '[app stops]',
              '[preview of uploaded]',
              // Until it hears how the actor ended, the observer follows previews.
              // The inline observer made under `failed` hears this one.
              `${stable ? 'uploading' : 'failed'}: next done:uploaded`,
              '[release]',
              `${stable ? 'uploading' : 'uploaded'}: complete`,
              '[afterwards]',
            ]
          : ['[app stops]', 'uploading: complete', '[preview of uploaded]', '[release]', '[afterwards]'],
      });
    });
  });
});

describeWithActivity('an Activity hides the component after the app stops the actor during a preview', () => {
  describe.each(IMPLEMENTATIONS)('like @xstate/react, with %s', (_, hooks, previews) => {
    describe.each([
      ['the registry drops it at its next flush', false],
      ['the developer releases it before that flush', true],
    ])('the preview ends while the upload is hidden: %s', (_, releaseWhileHidden) => {
      /**
       * Mounts `Upload` in an Activity, previews `failed` and cancels.
       * Then a tab switch hides the upload, the preview ends meanwhile, and the upload shows again.
       * `log` gets a marker before each step.
       * Returns the count of previews that the header showed while the upload was hidden.
       */
      async function cancelThenHideAndReveal(
        machine: UploadMachine,
        Upload: () => React.ReactNode,
        log: string[] = [],
      ): Promise<string> {
        function App({ mode }: { mode: 'visible' | 'hidden' }) {
          return (
            <React.Activity mode={mode}>
              <Upload />
            </React.Activity>
          );
        }

        const view = render(page(<App mode="visible" />));
        await flush();

        if (previews) await preview(machine.id, ['failed']);

        // Release all is on the machine list. Going there flushes the overlay, so it comes before the hide.
        if (releaseWhileHidden && previews) await machines();

        log.length = 0;
        log.push('[app stops]');
        await cancel();
        log.push('[hide]');
        view.rerender(page(<App mode="hidden" />));

        // The click comes before the registry's next flush, which drops the preview of an instance that unregistered.
        if (releaseWhileHidden && previews) await releaseAll();
        await flush();
        // The count is the page's. The @xstate/react row registers nothing, so it skips the read.
        const hidden = previews ? badge() : '';
        log.push('[reveal]');
        view.rerender(page(<App mode="visible" />));
        await flush();

        return hidden;
      }

      describe.each(OBSERVERS)('%s given to useActorRef', (_, stable) => {
        test('hears complete once by the reveal, and nothing of a later preview of the stopped actor', async () => {
          const machine = createUploadMachine();
          const calls: string[] = [];

          function Upload() {
            const actorRef = hooks.useActorRef(machine, undefined, useObserver(logTo(calls, () => 'upload'), stable));

            return (
              <button type="button" onClick={() => actorRef.stop()}>
                Cancel
              </button>
            );
          }

          const hidden = await cancelThenHideAndReveal(machine, Upload, calls);

          // Later the developer looks at the upload machine again, and releases it.
          calls.push('[later preview]');

          if (previews) await preview(machine.id, ['paused']);
          calls.push('[later release]');

          if (previews) await release(machine.id);
          expect({ hidden, calls }).toEqual({
            hidden: '',
            calls: previews
              ? ['[app stops]', '[hide]', '[reveal]', 'upload: complete', '[later preview]', '[later release]']
              : ['[app stops]', 'upload: complete', '[hide]', '[reveal]', '[later preview]', '[later release]'],
          });
        });
      });

      test('useMachine shows the stopped snapshot from the reveal on, and nothing of a later preview', async () => {
        const machine = createUploadMachine();

        function Upload() {
          const [snapshot, , actorRef] = hooks.useMachine(machine);

          return (
            <>
              <output aria-label="upload">{label(snapshot)}</output>
              <button type="button" onClick={() => actorRef.stop()}>
                Cancel
              </button>
            </>
          );
        }

        const hidden = await cancelThenHideAndReveal(machine, Upload);

        const revealed = shown('upload');

        if (previews) await preview(machine.id, ['paused']);
        const later = shown('upload');

        if (previews) await release(machine.id);
        expect({ hidden, revealed, later, released: shown('upload') }).toEqual({
          hidden: '',
          revealed: 'stopped:uploading',
          later: 'stopped:uploading',
          released: 'stopped:uploading',
        });
      });
    });
  });
});
