// An observer that unsubscribes from inside next gets nothing more, as with XState, which drops it from its observers
// at once (unsubscribing, even from inside next, ends all of it). When
// the actor finished during a preview, the proxy sends the done snapshot and then complete once the preview ends; an
// observer that unsubscribes in next on that done snapshot, having got what it waited for, gets no complete, whether
// the preview ends through a release or through the registry dropping the preview of the unregistered actor.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { assign, createActor, createMachine, type AnyActorRef, type Subscription } from 'xstate';
import { connect } from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

/** Finishes on FINISH; `waiting` exists to be previewed. */
const jobMachine = createMachine({
  id: 'job',
  initial: 'running',
  context: { result: 0 },
  states: {
    running: { on: { FINISH: { target: 'finished', actions: assign({ result: 42 }) } } },
    waiting: {},
    finished: { type: 'final' },
  },
});

/** Subscribes an observer that unsubscribes once it sees the done snapshot, and returns what it was told. */
function observeUntilDone(actor: AnyActorRef): string[] {
  const calls: string[] = [];
  let subscription: Subscription | undefined;
  subscription = actor.subscribe({
    next: (snapshot) => {
      calls.push(`next:${snapshot.status}`);
      if (snapshot.status === 'done') subscription?.unsubscribe();
    },
    complete: () => calls.push('complete'),
  });
  return calls;
}

beforeEach(() => {
  resetRegistry();
  // Previews of states without a recording or fixture warn about falling back to live context.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

describe('an observer that unsubscribes in next on the done snapshot', () => {
  test('control: plain XState never calls its complete', () => {
    const actor = createActor(jobMachine).start();
    const calls = observeUntilDone(actor);

    actor.send({ type: 'FINISH' });

    expect(calls).toEqual(['next:done']);
  });

  test('control: through the proxy without a preview, its complete is never called', () => {
    const proxy = connect(createActor(jobMachine).start());
    const calls = observeUntilDone(proxy);

    proxy.send({ type: 'FINISH' });

    expect(calls).toEqual(['next:done']);
  });

  test('when the actor finished during a preview, gets no complete after the release', () => {
    const actor = createActor(jobMachine).start();
    const calls = observeUntilDone(connect(actor));
    registry().preview(keyOf(onlyHandle('job')), { leaves: ['waiting'] });

    actor.send({ type: 'FINISH' });
    expect(calls).toEqual(['next:active']);
    registry().release();

    expect(calls).toEqual(['next:active', 'next:done']);
  });

  test('when the actor finished during a preview, gets no complete once the registry drops the preview', async () => {
    const actor = createActor(jobMachine).start();
    const calls = observeUntilDone(connect(actor));
    registry().preview(keyOf(onlyHandle('job')), { leaves: ['waiting'] });

    actor.send({ type: 'FINISH' });
    expect(calls).toEqual(['next:active']);
    // connect() unregistered the done actor; the flush sweeps it and releases its preview.
    await flush();

    expect(registry().getSnapshot().overrides).toEqual({});
    expect(calls).toEqual(['next:active', 'next:done']);
  });
});
