// XState drops an actor's observers once it's done, so apps routinely subscribe to a one-shot actor and never
// unsubscribe: `const job = createActor(m).start(); job.subscribe((s) => ...)`. Through connect() the same code doesn't
// keep the finished actor alive. A connect()ed actor unregisters when it ends and can never be previewed again, so once
// its last preview is released its binding stops listening to the page-wide registry (spec §10.2, "connect()"). That
// holds for subscribers without complete, which keep following previews of a finished machine until then (a listener
// function, or { next, error } like useSelector's), for a subscriber that came after the actor finished, and for an
// actor that finished while a preview showed.

import v8 from 'node:v8';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createActor, createMachine, type AnyActorRef, type Observer } from 'xstate';
import { connect } from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

v8.setFlagsFromString('--expose-gc');
const collectGarbage = vm.runInNewContext('gc') as () => void;

const jobMachine = createMachine({
  id: 'job',
  initial: 'running',
  states: { running: { on: { FINISH: 'finished' } }, finished: { type: 'final' } },
});

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

type Subscriber = ((snapshot: unknown) => void) | Observer<unknown>;

beforeEach(() => {
  resetRegistry();
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

describe.each<[name: string, make: () => Subscriber]>([
  ['a listener function', () => () => {}],
  ['an observer with next and error', () => ({ next: () => {}, error: () => {} })],
  ['an observer with next and complete', () => ({ next: () => {}, complete: () => {} })],
])('a finished job subscribed with %s, never unsubscribed', (_name, make) => {
  /** Runs a job to its final state with a subscriber that never unsubscribes, and forgets it. */
  function finishJob(wrap: boolean, late = false): WeakRef<AnyActorRef> {
    const actor = createActor(jobMachine).start();
    const job: AnyActorRef = wrap ? connect(actor) : actor;
    if (!late) job.subscribe(make() as Observer<unknown>);
    job.send({ type: 'FINISH' });
    if (late) job.subscribe(make() as Observer<unknown>);
    return new WeakRef(actor);
  }

  test('control: a plain actor can be garbage-collected', async () => {
    const refs = Array.from({ length: 5 }, () => finishJob(false));
    await flush();

    expect(await collected(refs)).toEqual([true, true, true, true, true]);
  });

  test('a connect()ed actor can be garbage-collected once it is done and unregistered', async () => {
    const refs = Array.from({ length: 5 }, () => finishJob(true));
    await flush();

    // Done, so connect() unregistered it: it can't be previewed any more.
    expect(registry().getSnapshot().machines).toEqual([]);
    expect(await collected(refs)).toEqual([true, true, true, true, true]);
  });

  test('a connect()ed actor subscribed after it finished can be garbage-collected', async () => {
    const refs = Array.from({ length: 5 }, () => finishJob(true, true));
    await flush();

    expect(registry().getSnapshot().machines).toEqual([]);
    expect(await collected(refs)).toEqual([true, true, true, true, true]);
  });
});

describe('a connect()ed job that finishes while a preview shows', () => {
  test('gets the held-back done snapshot when the preview is released, then can be garbage-collected', async () => {
    // Previews of states without a recording or fixture warn about falling back to live context.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: string[] = [];
    // A helper, so the test's own frame doesn't hold on to the last actor.
    const finishDuringPreview = (): WeakRef<AnyActorRef> => {
      const actor = createActor(jobMachine).start();
      const job = connect(actor);
      job.subscribe((snapshot) => seen.push((snapshot as { status: string }).status));
      registry().preview(keyOf(registry().getSnapshot().machines.at(-1)!), { leaves: ['running'] });
      // The real actor: the proxy blocks events during a preview (R12).
      actor.send({ type: 'FINISH' });
      return new WeakRef(actor);
    };
    const refs = Array.from({ length: 3 }, finishDuringPreview);
    expect(seen).toEqual(['active', 'active', 'active']);

    // The flush sweeps the unregistered instances and releases their previews (R13).
    await flush();
    expect(seen).toEqual(['active', 'active', 'active', 'done', 'done', 'done']);
    expect(registry().getSnapshot().machines).toEqual([]);
    expect(await collected(refs)).toEqual([true, true, true]);
  });

});

describe('a connect()ed job that finished', () => {
  test('hears no preview afterwards: the registry refuses previews of the unregistered key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const job = connect(createActor(jobMachine).start());
    const key = keyOf(onlyHandle('job'));
    const seen: string[] = [];
    job.subscribe((snapshot) => seen.push((snapshot as { status: string }).status));
    job.send({ type: 'FINISH' });
    await flush();
    expect(seen).toEqual(['done']);

    registry().preview(key, { leaves: ['running'] });
    await flush();
    expect(registry().getOverride(key)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no machine is registered under that key'));
    expect(seen).toEqual(['done']);
  });
});
