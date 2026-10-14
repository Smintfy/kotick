// toPromise(proxy) resolves with the output the real actor finished with, whatever a preview shows (spec §10.2, G3,
// R13). XState's toPromise subscribes an observer with only complete and error, and reads `actor.getSnapshot().output`
// inside complete; while that observer hears how the actor ended, the proxy shows the real snapshot. This holds for
// connect()ed and hook actors, whether the preview is of a non-final state or of another final state with other
// context, and when toPromise is called on an actor that is already done while a preview shows. A preview alone,
// even of a final state, doesn't settle the promise: an observer without next isn't told about previews.

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { assign, createActor, fromPromise, setup, toPromise, type Actor } from 'xstate';
import { connect, defineFixtures, useActorRef } from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

/** Settles the request the job waits on, as a server response would. */
let respond: ((result: number) => void) | undefined;

/**
 * Finishes with its result as output, when its request settles or on FINISH (sent to the real actor, as a timer or
 * another actor would). `waiting` and `cancelled` exist to be previewed.
 */
const jobMachine = setup({
  types: {
    context: {} as { result: number },
    events: {} as { type: 'FINISH' },
  },
  actors: {
    request: fromPromise(() => new Promise<number>((resolve) => (respond = resolve))),
  },
}).createMachine({
  id: 'job',
  initial: 'running',
  context: { result: 0 },
  states: {
    running: {
      invoke: {
        src: 'request',
        onDone: { target: 'finished', actions: assign({ result: ({ event }) => event.output }) },
      },
      on: { FINISH: { target: 'finished', actions: assign({ result: 42 }) } },
    },
    waiting: {},
    finished: { type: 'final' },
    cancelled: { type: 'final' },
  },
  output: ({ context }) => context.result,
});

type JobActor = Actor<typeof jobMachine>;

/** Context for the `cancelled` final state that gives an output other than the real one. */
const cancelledFixture = () => defineFixtures(jobMachine, { cancelled: { context: { result: -1 } } });

/** Mounts useActorRef(jobMachine) and returns the proxy it hands out. */
async function mountJob(): Promise<JobActor> {
  let actorRef: JobActor | undefined;
  function Job() {
    actorRef = useActorRef(jobMachine);
    return null;
  }
  render(<Job />);
  await flush();
  if (!actorRef) throw new Error('The job did not render.');
  return actorRef;
}

beforeEach(() => {
  resetRegistry();
  respond = undefined;
  // Previews of states without a recording or fixture warn about falling back to live context.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

describe('toPromise on a proxy whose actor finishes during a preview', () => {
  test('plain XState resolves with the output the actor finished with (control)', async () => {
    const actor = createActor(jobMachine).start();
    const done = toPromise(actor);

    actor.send({ type: 'FINISH' });

    await expect(done).resolves.toBe(42);
  });

  test('a connect()ed actor resolves with its real output without a preview (control)', async () => {
    const proxy = connect(createActor(jobMachine).start());
    const done = toPromise(proxy);

    respond?.(42);

    await expect(done).resolves.toBe(42);
  });

  test('a connect()ed actor resolves with its real output while a non-final state is previewed', async () => {
    const actor = createActor(jobMachine).start();
    const proxy = connect(actor);
    const done = toPromise(proxy);
    registry().preview(keyOf(onlyHandle('job')), { leaves: ['waiting'] });

    // The real actor keeps running underneath (R13) and finishes.
    actor.send({ type: 'FINISH' });
    expect(actor.getSnapshot().output).toBe(42);
    // The preview ends later, which changes nothing here.
    registry().release();

    await expect(done).resolves.toBe(42);
  });

  test('a connect()ed actor resolves with its real output while another final state is previewed', async () => {
    const actor = createActor(jobMachine).start();
    const proxy = connect(actor);
    const done = toPromise(proxy);
    registry().registerFixtures([cancelledFixture()]);
    registry().preview(keyOf(onlyHandle('job')), { leaves: ['cancelled'], source: 'fixture' });
    expect(proxy.getSnapshot()).toMatchObject({ status: 'done', output: -1 });

    actor.send({ type: 'FINISH' });
    registry().release();

    await expect(done).resolves.toBe(42);
  });

  test('a connect()ed actor finishing through its own invoke resolves with its real output', async () => {
    const actor = createActor(jobMachine).start();
    const proxy = connect(actor);
    const done = toPromise(proxy);

    registry().preview(keyOf(onlyHandle('job')), { leaves: ['waiting'] });
    respond?.(42);
    await vi.waitFor(() => expect(actor.getSnapshot().status).toBe('done'));

    await expect(done).resolves.toBe(42);
  });

  test('a hook actor finishing through its own invoke resolves with its real output', async () => {
    const proxy = await mountJob();
    const done = toPromise(proxy);

    act(() => registry().preview(keyOf(onlyHandle('job')), { leaves: ['waiting'] }));
    await act(async () => respond?.(42));
    // The real actor finished; hooks keep it registered, so the preview is still showing.
    await vi.waitFor(() => expect(onlyHandle('job').getActiveLeaves()).toEqual(['finished']));
    expect(proxy.getSnapshot()).toMatchObject({ status: 'active', value: 'waiting' });

    await expect(done).resolves.toBe(42);
  });

  test('a hook actor resolves with its real output while another final state is previewed', async () => {
    const proxy = await mountJob();
    const done = toPromise(proxy);
    act(() => registry().registerFixtures([cancelledFixture()]));

    act(() => registry().preview(keyOf(onlyHandle('job')), { leaves: ['cancelled'], source: 'fixture' }));
    expect(proxy.getSnapshot()).toMatchObject({ status: 'done', output: -1 });
    await act(async () => respond?.(42));
    await vi.waitFor(() => expect(onlyHandle('job').getActiveLeaves()).toEqual(['finished']));

    await expect(done).resolves.toBe(42);
  });
});

describe('toPromise called on a proxy whose actor is already done, during a preview', () => {
  test('a hook actor previewed in a non-final state resolves with its real output', async () => {
    const proxy = await mountJob();
    act(() => proxy.send({ type: 'FINISH' }));
    await flush();

    act(() => registry().preview(keyOf(onlyHandle('job')), { leaves: ['waiting'] }));
    expect(proxy.getSnapshot()).toMatchObject({ status: 'active', value: 'waiting' });

    await expect(toPromise(proxy)).resolves.toBe(42);
  });

  test('a hook actor previewed in another final state resolves with its real output', async () => {
    const proxy = await mountJob();
    act(() => registry().registerFixtures([cancelledFixture()]));
    act(() => proxy.send({ type: 'FINISH' }));
    await flush();

    act(() => registry().preview(keyOf(onlyHandle('job')), { leaves: ['cancelled'], source: 'fixture' }));
    expect(proxy.getSnapshot()).toMatchObject({ status: 'done', output: -1 });

    await expect(toPromise(proxy)).resolves.toBe(42);
  });

  test('a connect()ed actor that finished while previewed resolves with its real output', async () => {
    const actor = createActor(jobMachine).start();
    const proxy = connect(actor);
    registry().preview(keyOf(onlyHandle('job')), { leaves: ['waiting'] });

    actor.send({ type: 'FINISH' });
    // connect() unregisters the done actor; its preview shows until the registry's next flush drops it.
    expect(proxy.getSnapshot()).toMatchObject({ status: 'active', value: 'waiting' });

    await expect(toPromise(proxy)).resolves.toBe(42);
  });
});

describe('toPromise on a proxy whose actor is still running', () => {
  test('stays pending while a final state is previewed', async () => {
    const proxy = connect(createActor(jobMachine).start());
    let settled = false;
    void toPromise(proxy).then(
      () => (settled = true),
      () => (settled = true),
    );

    registry().preview(keyOf(onlyHandle('job')), { leaves: ['cancelled'] });
    expect(proxy.getSnapshot().status).toBe('done');
    await flush();

    expect(settled).toBe(false);
    proxy.stop();
  });
});
