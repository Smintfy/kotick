import { act, render } from '@testing-library/react';
import * as React from 'react';
import { useActorRef } from 'kotick/xstate';
import { describe, expect, test } from 'vitest';
import { createMachine, fromCallback, setup, type Observer } from 'xstate';
import { page, press } from '../support/app';
import { flush, freshId, machines, preview, release } from '../support/panel';

function createToggleMachine() {
  return createMachine({
    id: freshId('toggle'),
    initial: 'off',
    states: { off: { on: { TOGGLE: 'on' } }, on: { on: { TOGGLE: 'off' } } },
  });
}

function createUpload() {
  let answer: (() => void) | undefined;

  const machine = setup({
    actors: {
      socket: fromCallback(({ sendBack }) => {
        answer = () => sendBack({ type: 'UPLOADED' });

        return () => {
          answer = undefined;
        };
      }),
    },
  }).createMachine({
    id: freshId('upload'),
    initial: 'uploading',
    states: {
      uploading: { invoke: { src: 'socket' }, on: { UPLOADED: 'uploaded' } },
      failed: {},
      uploaded: { type: 'final' },
    },
  });

  const finish = async (): Promise<void> => {
    act(() => answer?.());
    await flush();
  };

  return { machine, finish };
}

type Snapshot = { status: string; value: unknown };

const label = (snapshot: Snapshot): string => `${snapshot.status}:${String(snapshot.value)}`;

function recorder(heard: string[]): Observer<Snapshot> {
  return { next: (snapshot) => heard.push(label(snapshot)), complete: () => heard.push('complete') };
}

test('debug.disabled takes the machine out of the overlay, and the observer goes on hearing the real actor', async () => {
  const machine = createToggleMachine();
  const heard: string[] = [];

  function Toggle({ disabled }: { disabled: boolean }) {
    const actorRef = useActorRef(machine, { debug: { disabled } }, (snapshot: Snapshot) => {
      heard.push(label(snapshot));
    });

    return (
      <button type="button" onClick={() => actorRef.send({ type: 'TOGGLE' })}>
        Toggle
      </button>
    );
  }

  const view = render(page(<Toggle disabled={false} />));
  await flush();

  const mounted = { heard: heard.splice(0), listed: await machines() };
  view.rerender(page(<Toggle disabled />));
  await flush();
  const disabled = { heard: heard.splice(0), listed: await machines() };
  await press('Toggle');
  const toggled = heard.splice(0);
  view.rerender(page(<Toggle disabled={false} />));
  await flush();
  expect({ mounted, disabled, toggled, enabled: { heard, listed: await machines() } }).toEqual({
    // StrictMode starts the actor twice.
    mounted: { heard: ['active:off', 'active:off'], listed: [machine.id] },
    disabled: { heard: [], listed: [] },
    toggled: ['active:on'],
    enabled: { heard: [], listed: [machine.id] },
  });
});

test('turning debug.disabled on, with nothing previewed, sends an observer that the component passed after the actor moved nothing until the next change', async () => {
  const machine = createToggleMachine();
  const heard: string[] = [];

  const onChange = (snapshot: Snapshot) => {
    heard.push(label(snapshot));
  };

  function Toggle({ panelOpen, disabled }: { panelOpen: boolean; disabled: boolean }) {
    const actorRef = useActorRef(machine, { debug: { disabled } }, panelOpen ? onChange : undefined);

    return (
      <button type="button" onClick={() => actorRef.send({ type: 'TOGGLE' })}>
        Toggle
      </button>
    );
  }

  const view = render(page(<Toggle panelOpen={false} disabled={false} />));
  await flush();

  await press('Toggle');
  view.rerender(page(<Toggle panelOpen disabled={false} />));
  await flush();
  const opened = heard.splice(0);
  view.rerender(page(<Toggle panelOpen disabled />));
  await flush();
  const disabled = heard.splice(0);
  await press('Toggle');
  expect({ opened, disabled, toggled: heard }).toEqual({
    // @xstate/react subscribes the observer to an actor that already moved, and XState sends it nothing.
    opened: [],
    disabled: [],
    toggled: ['active:off'],
  });
});

describe('debug.disabled turns on while a preview shows', () => {
  async function mountAndPreview() {
    const upload = createUpload();
    const heard: string[] = [];

    function Upload({ disabled }: { disabled: boolean }) {
      useActorRef(upload.machine, { debug: { disabled } }, recorder(heard));

      return null;
    }

    const view = render(page(<Upload disabled={false} />));
    await flush();
    await preview(upload.machine.id, ['failed']);

    const disable = async (): Promise<void> => {
      view.rerender(page(<Upload disabled />));
      await flush();
    };

    return { heard, finish: upload.finish, disable };
  }

  /** What the observer hears as the actor starts, under StrictMode twice, and as the preview shows. */
  const PREVIEWING = ['active:uploading', 'active:uploading', 'active:failed'];

  test('the actor finished under the preview: the observer gets the done snapshot, then complete, and nothing else of the hook', async () => {
    const { heard, finish, disable } = await mountAndPreview();
    const previewed = heard.splice(0);

    await finish();
    const finished = heard.splice(0);
    await disable();
    const disabled = { heard: heard.splice(0), listed: await machines() };
    await disable();
    expect({ previewed, finished, disabled, later: heard }).toEqual({
      previewed: PREVIEWING,
      // The preview hides the ending.
      // It loses the socket that the real actor stops, so the observer hears the preview again.
      finished: ['active:failed'],
      // @xstate/react subscribes an inline observer object again on each render, and XState completes it at once.
      disabled: { heard: ['done:uploaded', 'complete', 'complete'], listed: [] },
      later: ['complete'],
    });
  });

  test('the actor still runs: the observer is shown the real snapshot, then follows the actor', async () => {
    const { heard, finish, disable } = await mountAndPreview();
    const previewed = heard.splice(0);

    await disable();
    const disabled = { heard: heard.splice(0), listed: await machines() };
    await disable();
    const later = heard.splice(0);
    await finish();
    expect({ previewed, disabled, later, finished: heard }).toEqual({
      previewed: PREVIEWING,
      disabled: { heard: ['active:uploading'], listed: [] },
      later: [],
      finished: ['done:uploaded', 'complete'],
    });
  });
});

test('debug.disabled from the mount, then turned off: a stable listener of the running actor sees a preview, then the real snapshot, once each', async () => {
  const upload = createUpload();
  const heard: string[] = [];

  function Upload({ disabled }: { disabled: boolean }) {
    const [listener] = React.useState(() => (snapshot: Snapshot) => {
      heard.push(label(snapshot));
    });

    useActorRef(upload.machine, { debug: { disabled } }, listener);

    return null;
  }

  const view = render(page(<Upload disabled />));
  await flush();
  view.rerender(page(<Upload disabled={false} />));
  await flush();

  await preview(upload.machine.id, ['failed']);
  await release(upload.machine.id);
  expect(heard).toEqual(['active:uploading', 'active:uploading', 'active:failed', 'active:uploading']);
});
