// The proxy's subscribe() and the observer forwarding of useActorRef register a registry.onOverride listener next to
// the XState observer. XState drops its observers by itself when the actor is done, stopped or fails, without calling
// unsubscribe(), so the override listener has to go (or at least stop delivering) along with it.

import { act, render } from '@testing-library/react';
import v8 from 'node:v8';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createActor, createMachine, toPromise, type Actor, type AnyActorRef, type SnapshotFrom } from 'xstate';
import { connect, useActorRef } from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

v8.setFlagsFromString('--expose-gc');
const collectGarbage = vm.runInNewContext('gc') as () => void;

const jobMachine = createMachine({
  id: 'job',
  initial: 'running',
  context: { attempts: 0 },
  states: {
    running: { on: { FINISH: 'finished' } },
    finished: { type: 'final' },
  },
});

type JobSnapshot = SnapshotFrom<typeof jobMachine>;

/**
 * Which of the targets are gone after a few full collections. Nothing derefs before collecting: a WeakRef keeps its
 * target alive until the job that created or read it ends.
 */
async function collected(refs: WeakRef<object>[]): Promise<boolean[]> {
  for (let turn = 0; turn < 3; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    collectGarbage();
  }
  return refs.map((ref) => ref.deref() === undefined);
}

beforeEach(() => {
  resetRegistry();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

describe('a connected actor that finished', () => {
  /** Runs a connected job to its final state, unsubscribing from the proxy afterwards, and forgets it. */
  async function finishUnsubscribed(): Promise<WeakRef<AnyActorRef>> {
    const actor = createActor(jobMachine).start();
    const proxy = connect(actor);
    const subscription = proxy.subscribe(() => {});
    proxy.send({ type: 'FINISH' });
    subscription.unsubscribe();
    return new WeakRef(actor);
  }

  /** Runs a connected job to its final state, awaiting it with toPromise, which never unsubscribes, and forgets it. */
  async function finishWithToPromise(): Promise<WeakRef<AnyActorRef>> {
    const actor = createActor(jobMachine).start();
    const proxy = connect(actor);
    const done = toPromise(proxy);
    proxy.send({ type: 'FINISH' });
    await done;
    return new WeakRef(actor);
  }

  test('can be garbage-collected once its proxy subscription was unsubscribed (baseline)', async () => {
    const refs = [];
    for (let i = 0; i < 5; i++) refs.push(await finishUnsubscribed());
    await flush();

    expect(registry().getSnapshot().machines).toEqual([]);
    expect(await collected(refs)).toEqual([true, true, true, true, true]);
  });

  test('can be garbage-collected after toPromise, whose observer XState completed and dropped', async () => {
    const refs = [];
    for (let i = 0; i < 5; i++) refs.push(await finishWithToPromise());
    await flush();

    expect(registry().getSnapshot().machines).toEqual([]);
    // Only the registry's override listener for each instance key, added by proxy.subscribe and never removed, can
    // still reach these actors.
    expect(await collected(refs)).toEqual([true, true, true, true, true]);
  });
});

describe('an observer that XState completed', () => {
  test('gets no next from the proxy when the actor is stopped during a preview and the preview is dropped', async () => {
    const proxy = connect(createActor(jobMachine).start());
    const calls: string[] = [];
    proxy.subscribe({
      next: (snapshot) => calls.push(`next:${snapshot.status}`),
      complete: () => calls.push('complete'),
    });
    registry().preview(keyOf(onlyHandle('job')), { leaves: ['running'] });

    // The preview hides the stop, so complete waits for it to end.
    proxy.stop();
    expect(calls).toEqual(['next:active']);

    // The flush sweeps the unregistered instance and releases its preview: complete, and no next.
    await flush();
    expect(calls).toEqual(['next:active', 'complete']);
  });

  test('gets no next from useActorRef when its finished actor is previewed', async () => {
    const calls: string[] = [];
    const observer = {
      next: (snapshot: JobSnapshot) => calls.push(`next:${snapshot.status}`),
      complete: () => calls.push('complete'),
    };
    let actorRef: Actor<typeof jobMachine> | undefined;
    function Job() {
      actorRef = useActorRef(jobMachine, undefined, observer);
      return null;
    }
    render(<Job />);
    await flush();

    act(() => actorRef?.send({ type: 'FINISH' }));
    await flush();
    expect(calls.slice(-2)).toEqual(['next:done', 'complete']);
    calls.length = 0;

    // Hooks keep a finished actor registered, so it can still be previewed.
    act(() => registry().preview(keyOf(onlyHandle('job')), { leaves: ['running'] }));
    await flush();
    expect(calls).toEqual([]);
  });
});
