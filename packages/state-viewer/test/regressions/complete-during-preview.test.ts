// XState sends an observer the done snapshot before complete. When the real actor finishes while a preview shows, the
// proxy holds the done snapshot back (it isn't what the proxy shows), so complete waits too: once the preview ends,
// through a release or the registry dropping the preview of an unregistered actor, observers with next get the done
// snapshot and then complete. waitFor(proxy, ...) therefore resolves when the actor finishes as awaited, as it
// does on a plain actor, whether the actor finishes from an event sent to it or through its own invoke.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { assign, createActor, createMachine, fromPromise, waitFor, type AnyActorRef } from 'xstate';
import { connect } from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

/** Finishes with output 42 on FINISH; `waiting` exists to be previewed. */
const jobMachine = createMachine({
  id: 'job',
  initial: 'running',
  context: { result: 0 },
  states: {
    running: { on: { FINISH: { target: 'finished', actions: assign({ result: 42 }) } } },
    waiting: {},
    finished: { type: 'final' },
  },
  output: ({ context }) => context.result,
});

/** Settles the fetch the fetcher waits on. */
let resolveFetch: (value: number) => void = () => {};

/** Finishes once its invoked fetch settles; `failed` exists to be previewed. */
const fetchMachine = createMachine({
  id: 'fetcher',
  initial: 'loading',
  states: {
    loading: {
      invoke: {
        src: fromPromise(() => new Promise<number>((resolve) => (resolveFetch = resolve))),
        onDone: 'finished',
      },
    },
    failed: {},
    finished: { type: 'final' },
  },
});

/** Subscribes an observer with next and complete to the proxy, and returns what it was told. */
function observe(proxy: AnyActorRef): string[] {
  const calls: string[] = [];
  proxy.subscribe({
    next: (snapshot) => calls.push(`next:${snapshot.status}:${String(snapshot.value)}`),
    complete: () => calls.push('complete'),
  });
  return calls;
}

/** What waitFor settles with, as a string, so a rejection shows in the assertion. */
function settledWaitFor(proxy: AnyActorRef, state: string): Promise<string> {
  return waitFor(proxy, (snapshot) => snapshot.matches(state)).then(
    (snapshot) => `resolved:${snapshot.status}`,
    (error: Error) => `rejected:${error.message}`,
  );
}

beforeEach(() => {
  resetRegistry();
  resolveFetch = () => {};
  // Previews of states without a recording or fixture warn about falling back to live context.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

describe('an actor sent the event that finishes it during a preview', () => {
  test('plain XState: waitFor for the final state resolves (control)', async () => {
    const actor = createActor(jobMachine).start();
    const finished = waitFor(actor, (snapshot) => snapshot.matches('finished'));

    actor.send({ type: 'FINISH' });

    await expect(finished).resolves.toMatchObject({ status: 'done', output: 42 });
  });

  test('an observer of the proxy gets the done snapshot, then complete, once the preview is released', () => {
    const actor = createActor(jobMachine).start();
    const calls = observe(connect(actor));
    registry().preview(keyOf(onlyHandle('job')), { leaves: ['waiting'] });

    actor.send({ type: 'FINISH' });
    expect(actor.getSnapshot().status).toBe('done');
    // Complete waits while the preview hides the done snapshot.
    expect(calls).toEqual(['next:active:waiting']);

    registry().release();
    expect(calls).toEqual(['next:active:waiting', 'next:done:finished', 'complete']);
  });

  test('an observer of the proxy gets the done snapshot, then complete, once the registry drops the preview', async () => {
    const actor = createActor(jobMachine).start();
    const calls = observe(connect(actor));
    registry().preview(keyOf(onlyHandle('job')), { leaves: ['waiting'] });

    actor.send({ type: 'FINISH' });
    expect(calls).toEqual(['next:active:waiting']);

    // connect() unregistered the done actor; the flush sweeps it and releases its preview.
    await flush();
    expect(calls).toEqual(['next:active:waiting', 'next:done:finished', 'complete']);
  });

  test('waitFor on the proxy resolves with the done snapshot once the preview is released', async () => {
    const actor = createActor(jobMachine).start();
    const proxy = connect(actor);
    const finished = waitFor(proxy, (snapshot) => snapshot.matches('finished'));
    registry().preview(keyOf(onlyHandle('job')), { leaves: ['waiting'] });

    actor.send({ type: 'FINISH' });
    expect(actor.getSnapshot().status).toBe('done');
    registry().release();

    await expect(finished).resolves.toMatchObject({ status: 'done', output: 42 });
  });
});

describe('an actor finished by its own invoke during a preview', () => {
  test('control: waitFor on the proxy resolves without a preview', async () => {
    const proxy = connect(createActor(fetchMachine).start());
    const settled = settledWaitFor(proxy, 'finished');

    resolveFetch(1);
    await flush();

    expect(await settled).toBe('resolved:done');
  });

  test('an observer of the proxy gets the done snapshot before complete', async () => {
    const actor = createActor(fetchMachine).start();
    const calls = observe(connect(actor));
    registry().preview(keyOf(onlyHandle('fetcher')), { leaves: ['failed'] });

    resolveFetch(1);
    await vi.waitFor(() => expect(actor.getSnapshot().status).toBe('done'));
    await flush();

    // The preview shows again when the live children it carries over change; after it, the actor's ending
    // comes in XState's order, once each.
    expect(calls.slice(-2)).toEqual(['next:done:finished', 'complete']);
    expect(calls.slice(0, -2).every((call) => call === 'next:active:failed')).toBe(true);
  });

  test('waitFor on the proxy resolves with the done snapshot', async () => {
    const actor = createActor(fetchMachine).start();
    const proxy = connect(actor);
    const settled = settledWaitFor(proxy, 'finished');
    registry().preview(keyOf(onlyHandle('fetcher')), { leaves: ['failed'] });

    resolveFetch(1);
    await vi.waitFor(() => expect(actor.getSnapshot().status).toBe('done'));
    await flush();

    expect(await settled).toBe('resolved:done');
  });
});
