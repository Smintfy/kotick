// A child machine that reaches a final state has its final configuration recorded before it leaves the registry, as
// a root has (spec §10.3: "On each real snapshot, keep { leaves, context } per configuration key"; R17). Recordings
// are kept per machine id, so another instance of the same machine can then preview that state with the context a
// real actor reached. Both ways the adapter learns a child ended record it: the child's own done snapshot, when the
// inspector sees it first (an event sent through the parent), and the root-snapshot backstop, when the parent moves
// on before the child's done snapshot comes in (an event sent to the child directly).

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { assign, createActor, sendTo, setup, type AnyActorRef, type InspectionEvent } from 'xstate';
import { connect, useActorRef } from '../../src/xstate';
import { flush, handlesOf, keyOf, registry, resetRegistry } from '../xstate/helpers';

const uploadMachine = setup({
  types: {
    context: {} as { progress: number },
    events: {} as { type: 'PROGRESS' } | { type: 'FINISH' },
  },
}).createMachine({
  id: 'upload',
  context: { progress: 0 },
  initial: 'uploading',
  states: {
    uploading: {
      on: {
        PROGRESS: { actions: assign({ progress: ({ context }) => context.progress + 50 }) },
        FINISH: { target: 'complete', actions: assign({ progress: 100 }) },
      },
    },
    complete: { type: 'final' },
  },
});

const pageMachine = setup({
  types: { events: {} as { type: 'PROGRESS' } | { type: 'FINISH' } },
  actors: { upload: uploadMachine },
}).createMachine({
  id: 'page',
  initial: 'uploading',
  states: {
    uploading: {
      invoke: { id: 'upload', src: 'upload', onDone: 'uploaded' },
      on: {
        PROGRESS: { actions: sendTo('upload', { type: 'PROGRESS' }) },
        FINISH: { actions: sendTo('upload', { type: 'FINISH' }) },
      },
    },
    uploaded: {},
  },
});

function recordedLeaves(machineId: string): string[] {
  const availability = registry().getSnapshot().data[machineId];
  return availability ? [...availability.recorded].sort() : [];
}

/**
 * The order in which the system's inspectors see the child's done snapshot and the page's move to `uploaded`, which
 * tells which of the two ways the adapter learns about the child's end comes first.
 */
const endings: string[] = [];

function inspect(event: InspectionEvent): void {
  if (event.type !== '@xstate.snapshot') return;
  const snapshot = event.snapshot as { status?: string; value?: unknown };
  const logic = (event.actorRef as { logic?: unknown }).logic;
  if (logic === uploadMachine && snapshot.status === 'done') endings.push('upload done');
  if (logic === pageMachine && snapshot.value === 'uploaded') endings.push('page uploaded');
}

function Host({ onActor }: { onActor: (actor: AnyActorRef) => void }) {
  onActor(useActorRef(pageMachine, { inspect }));
  return null;
}

let other: AnyActorRef | undefined;

beforeEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  resetRegistry();
  endings.length = 0;
  // Previews of states without a recording or fixture warn about falling back to live context.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  other?.stop();
  other = undefined;
  vi.restoreAllMocks();
});

/** A second, idle instance of the upload machine, so its recordings show in the registry's data. */
function connectIdleUpload(): string {
  other = connect(createActor(uploadMachine).start(), { label: 'idle one' });
  const handle = handlesOf('upload').find((candidate) => candidate.label === 'idle one');
  if (!handle) throw new Error('The idle upload did not register.');
  return keyOf(handle);
}

function childUploads() {
  return handlesOf('upload').filter((handle) => handle.parentKey !== undefined);
}

/** Mounts the page, lets its upload child make progress, and returns the page's proxy. */
async function mountPage(): Promise<AnyActorRef> {
  let page: AnyActorRef | undefined;
  render(<Host onActor={(actor) => (page = actor)} />);
  await flush();
  if (!page) throw new Error('The page did not render.');
  expect(childUploads()).toHaveLength(1);
  const proxy = page;
  act(() => proxy.send({ type: 'PROGRESS' }));
  await flush();
  return proxy;
}

describe('a child machine reaching its final state', () => {
  test('control: a connect()ed root of the same machine records its final configuration', async () => {
    connectIdleUpload();
    const upload = connect(createActor(uploadMachine).start());
    upload.send({ type: 'FINISH' });
    await flush();
    expect(recordedLeaves('upload')).toEqual(['complete', 'uploading']);
  });

  test('records the final configuration from its done snapshot (an event sent through the parent)', async () => {
    const idleKey = connectIdleUpload();
    const page = await mountPage();

    act(() => page.send({ type: 'FINISH' }));
    await flush();
    expect(page.getSnapshot().value).toBe('uploaded');
    expect(childUploads()).toEqual([]);
    // The child's done snapshot came in before the page moved on.
    expect(endings).toEqual(['upload done', 'page uploaded']);

    // The child really was in 'complete' with { progress: 100 }.
    expect(recordedLeaves('upload')).toEqual(['complete', 'uploading']);
    act(() => registry().preview(idleKey, { leaves: ['complete'] }));
    expect(registry().getOverride(idleKey)).toMatchObject({ source: 'recorded', context: { progress: 100 } });
  });

  test('records the final configuration through the root-snapshot backstop (an event sent to the child)', async () => {
    const idleKey = connectIdleUpload();
    const page = await mountPage();
    const child = (page.getSnapshot() as { children: Record<string, AnyActorRef> }).children.upload;

    act(() => child.send({ type: 'FINISH' }));
    await flush();
    expect(page.getSnapshot().value).toBe('uploaded');
    expect(childUploads()).toEqual([]);
    // The page moved on, with the child already done, before the child's own done snapshot came in.
    expect(endings).toEqual(['page uploaded', 'upload done']);

    expect(recordedLeaves('upload')).toEqual(['complete', 'uploading']);
    act(() => registry().preview(idleKey, { leaves: ['complete'] }));
    expect(registry().getOverride(idleKey)).toMatchObject({ source: 'recorded', context: { progress: 100 } });
  });
});
