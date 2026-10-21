import { act, render, screen } from '@testing-library/react';
import * as React from 'react';
import { connect, useActorRef, useMachine, useSelector } from 'konat/xstate';
import { describe, expect, test } from 'vitest';
import { createActor, createMachine, type AnyActorRef, type Observer, type SnapshotFrom } from 'xstate';
import { page, press } from '../support/app';
import { badge, flush, freshId, instances, panel, preview, release } from '../support/panel';

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

/** The upload as useMachine shows it, and as a useSelector consumer of its actor shows it. */
function Upload({ machine }: { machine: UploadMachine }) {
  const [snapshot, , actorRef] = useMachine(machine);

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

/** An upload that useActorRef runs, with a useSelector consumer named after each of `readers`. */
function Cancellable({ machine, readers }: { machine: UploadMachine; readers: string[] }) {
  const actorRef = useActorRef(machine);

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

test('a connected actor read with useSelector, stopped during a preview, shows the real, stopped snapshot once the overlay drops the preview', async () => {
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

test('after the app stopped a hook actor during a preview, nothing previews the hook or a useSelector consumer, though the hook keeps the stopped actor listed', async () => {
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

describe('a consumer that subscribes after a stop during a preview', () => {
  /** Previews `failed`, cancels, and edits the machine, as Fast Refresh does, which gives useMachine a new actor. */
  async function fastRefreshAfterStop(): Promise<{ id: string; consumer: string }> {
    const id = freshId('upload');

    function FastRefreshed({ machine }: { machine: UploadMachine }) {
      const [snapshot, , actorRef] = useMachine(machine);

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
    await preview(id, ['failed']);
    await cancel();
    view.rerender(page(<FastRefreshed machine={createUploadMachine(id)} />));
    await flush();

    return { id, consumer: 'upload' };
  }

  /** Previews `failed`, cancels, and mounts a Cancelled panel that reads the stopped actor with useSelector. */
  async function mountReaderAfterStop(): Promise<{ id: string; consumer: string }> {
    const machine = createUploadMachine();
    const view = render(page(<Cancellable machine={machine} readers={[]} />));
    await flush();
    await preview(machine.id, ['failed']);
    await cancel();
    view.rerender(page(<Cancellable machine={machine} readers={['cancelled']} />));
    await flush();

    return { id: machine.id, consumer: 'cancelled' };
  }

  test.each([
    ['useMachine, given a new actor by Fast Refresh,', fastRefreshAfterStop],
    ['a useSelector consumer that mounts', mountReaderAfterStop],
  ])('%s shows the real, stopped snapshot once the preview is released', async (_, stopThenSubscribe) => {
    const { id, consumer } = await stopThenSubscribe();

    await release(id);
    expect(shown(consumer)).toEqual('stopped:uploading');
  });
});

test('an inline observer given to useActorRef hears complete once, on the release, when the app stops the actor during a preview, and nothing of a later preview', async () => {
  const machine = createUploadMachine();
  const calls: string[] = [];

  // The observer is tagged with the hint its parent passed, so the log tells which render's observer heard it.
  function Hinted({ hint }: { hint: string }) {
    const actorRef = useActorRef(machine, undefined, logTo(calls, () => hint));

    return (
      <button type="button" onClick={() => actorRef.stop()}>
        Cancel
      </button>
    );
  }

  const view = render(page(<Hinted hint="Uploading" />));
  await flush();
  await preview(machine.id, ['failed']);

  calls.length = 0;
  calls.push('[app stops]');
  await cancel();
  calls.push('[release]');
  await release(machine.id);
  calls.push('[afterwards]');
  view.rerender(page(<Hinted hint="Closed" />));
  await flush();
  await preview(machine.id, ['uploaded']);
  await release(machine.id);
  expect(calls).toEqual(['[app stops]', '[release]', 'Uploading: complete', '[afterwards]']);
});
