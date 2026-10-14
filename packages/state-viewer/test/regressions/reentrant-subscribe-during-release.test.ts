// A connect()ed actor that finishes while a preview shows holds its ending back from the proxy's subscribers until the
// preview ends, through registry().release() or the registry dropping the preview of the unregistered actor at its
// next flush; each subscriber then gets the done snapshot and complete, in the order they subscribed (spec §10.2
// "Observers and the actor's ending", "connect()"; R13). A subscriber may subscribe to the proxy again from inside its
// next or complete while that ending is delivered (subscribe, select().subscribe, waitFor): every subscriber after it
// still hears the done snapshot and complete, wherever the one that subscribes again sits among them, and a waitFor
// created before the preview resolves with the output, as on a plain actor. The binding stops listening to the
// page-wide registry once the delivery is over, so the finished actor can still be garbage-collected, though neither
// the subscriptions nor the ones made again are ever ended.

import v8 from 'node:v8';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { assign, createActor, createMachine, waitFor, type AnyActorRef } from 'xstate';
import { connect } from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

v8.setFlagsFromString('--expose-gc');
const collectGarbage = vm.runInNewContext('gc') as () => void;

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

type Status = { status: string };
type Where = 'next' | 'complete';
type Position = 'first' | 'middle' | 'last';
type Resubscribe = (job: AnyActorRef) => void;

const HOWS: [how: string, resubscribe: Resubscribe][] = [
  [
    'subscribe',
    (job) => {
      job.subscribe(() => {});
    },
  ],
  [
    'select().subscribe',
    (job) => {
      job.select((snapshot: Status) => snapshot.status).subscribe(() => {});
    },
  ],
  [
    'waitFor',
    (job) => {
      // Never satisfied: it rejects once it hears the job ended.
      void waitFor(job, (snapshot) => snapshot.matches('running')).catch(() => {});
    },
  ],
];
const WHERES: Where[] = ['next', 'complete'];
const POSITIONS: Position[] = ['first', 'middle', 'last'];
const NAMES = ['a', 'b', 'c'] as const;

/** Every combination of where the subscriber subscribes again, how, and its place among the three. */
const CASES = WHERES.flatMap((where) =>
  HOWS.flatMap(([how, resubscribe]) =>
    POSITIONS.map((position) => [where, how, position, resubscribe] as [Where, string, Position, Resubscribe]),
  ),
);

/**
 * Subscribes a, b and c to the job in that order; the one at `position` subscribes to the job again from inside
 * `where` once it hears the job end. Then waits for the final state, and returns what that wait settles with.
 */
function subscribeAll(
  job: AnyActorRef,
  calls: string[],
  where: Where,
  position: Position,
  resubscribe: Resubscribe,
): Promise<string> {
  NAMES.forEach((name, index) => {
    const again = index === POSITIONS.indexOf(position);
    job.subscribe({
      next: (snapshot: Status) => {
        calls.push(`${name}:${snapshot.status}`);
        if (again && where === 'next' && snapshot.status === 'done') resubscribe(job);
      },
      complete: () => {
        calls.push(`${name}:complete`);
        if (again && where === 'complete') resubscribe(job);
      },
    });
  });
  return waitFor(job, (snapshot) => snapshot.matches('finished')).then(
    (snapshot) => `resolved:${String(snapshot.output)}`,
    (error: Error) => `rejected:${error.message}`,
  );
}

/** What the promise settled with by the next macrotask, or 'pending'. */
async function settledBy(promise: Promise<string>): Promise<string> {
  let settled = 'pending';
  void promise.then((value) => (settled = value));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return settled;
}

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
  // Previews of states without a recording or fixture warn about falling back to live context.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

describe.each<[name: string, wrap: boolean]>([
  ['a plain actor (control)', false],
  ['a connect()ed actor without a preview (control)', true],
])('%s finishing, with a subscriber that subscribes again as it hears the end', (_name, wrap) => {
  test.each(CASES)(
    'from inside %s (%s), subscriber %s: every subscriber hears the end',
    async (where, _how, position, resubscribe) => {
      const actor = createActor(jobMachine).start();
      const job: AnyActorRef = wrap ? connect(actor) : actor;
      const calls: string[] = [];
      const finished = subscribeAll(job, calls, where, position, resubscribe);

      job.send({ type: 'FINISH' });
      await flush();

      // XState sends every observer the done snapshot, then calls every complete.
      expect(calls).toEqual(['a:done', 'b:done', 'c:done', 'a:complete', 'b:complete', 'c:complete']);
      expect(await settledBy(finished)).toBe('resolved:42');
    },
  );
});

describe.each<[name: string, end: () => Promise<void>]>([
  [
    'the registry drops the preview at its next flush',
    // connect() unregistered the done actor; the flush sweeps it and releases its preview.
    () => flush(),
  ],
  [
    'registry().release() is called',
    async () => {
      registry().release();
      await flush();
    },
  ],
])('a connect()ed job that finished during a preview, when %s', (_name, end) => {
  test.each(CASES)(
    'from inside %s (%s), subscriber %s: every subscriber hears the done snapshot and complete',
    async (where, _how, position, resubscribe) => {
      const actor = createActor(jobMachine).start();
      const job = connect(actor);
      const calls: string[] = [];
      const finished = subscribeAll(job, calls, where, position, resubscribe);
      registry().preview(keyOf(onlyHandle('job')), { leaves: ['waiting'] });
      // The real actor finishes: the proxy blocks events during a preview (R12).
      actor.send({ type: 'FINISH' });
      expect(actor.getSnapshot().status).toBe('done');
      expect(calls).toEqual(['a:active', 'b:active', 'c:active']);

      await end();

      expect(registry().getSnapshot().overrides).toEqual({});
      // The preview, then each subscriber in turn hears the held-back done snapshot and complete.
      expect(calls).toEqual([
        'a:active',
        'b:active',
        'c:active',
        'a:done',
        'a:complete',
        'b:done',
        'b:complete',
        'c:done',
        'c:complete',
      ]);
      expect(await settledBy(finished)).toBe('resolved:42');
    },
  );
});

describe('a connect()ed job that finished during a preview, with subscriptions never ended', () => {
  test.each(WHERES.flatMap((where) => HOWS.map(([how, resubscribe]) => [where, how, resubscribe] as const)))(
    'can be garbage-collected after a subscriber subscribed again from inside %s (%s)',
    async (where, _how, resubscribe) => {
      const heard: string[] = [];
      // A helper, so the test's own frame doesn't hold on to the last actor.
      const finishDuringPreview = (): WeakRef<AnyActorRef> => {
        const actor = createActor(jobMachine).start();
        const job = connect(actor);
        void subscribeAll(job, [], where, 'first', resubscribe).then((settled) => heard.push(settled));
        registry().preview(keyOf(registry().getSnapshot().machines.at(-1)!), { leaves: ['waiting'] });
        // The real actor: the proxy blocks events during a preview (R12).
        actor.send({ type: 'FINISH' });
        return new WeakRef(actor);
      };
      const refs = Array.from({ length: 3 }, finishDuringPreview);

      // The flush sweeps the unregistered instances and releases their previews (R13).
      await flush();
      expect(registry().getSnapshot().machines).toEqual([]);
      expect(registry().getSnapshot().overrides).toEqual({});
      expect(await collected(refs)).toEqual([true, true, true]);
      expect(heard).toEqual(['resolved:42', 'resolved:42', 'resolved:42']);
    },
  );
});
