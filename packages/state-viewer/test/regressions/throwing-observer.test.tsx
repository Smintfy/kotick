// What an observer's callback throws is isolated as XState isolates it: it is reported from a timer, and the view
// carries on with the bookkeeping that follows the call:
//
// - When the actor finishes while a preview shows, the view holds the done snapshot and complete back until the
//   preview ends, then delivers both. A next that throws on the done snapshot still has complete follow it, so the
//   observer hears complete, and a waitFor whose predicate throws on the final snapshot still rejects with "Actor
//   terminated without satisfying predicate" once the preview is released, as both do on a plain actor.
// - A proxy.subscribe() observer stops once its own complete or error has been called, even when that callback throws,
//   whether it hears the ending as the actor ends or when the preview that held it back is released. So it hears no
//   preview of the finished or failed actor afterwards, as with XState, which drops it and sends it nothing more.

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createActor,
  createMachine,
  waitFor,
  type Actor,
  type AnyActorRef,
  type Observer,
  type SnapshotFrom,
} from 'xstate';
import * as stateViewer from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

type Outcome = 'FINISH' | 'FAIL';

/**
 * The real actor of the job started last, which the machine's own actions get as `self`. Events sent to it go past the
 * proxy, which blocks them during a preview, as the job's own invoke or a timer would.
 */
let realJob: AnyActorRef | undefined;

const jobMachine = createMachine({
  id: 'job',
  initial: 'running',
  entry: ({ self }) => {
    realJob = self;
  },
  states: {
    running: {
      on: {
        FINISH: 'finished',
        FAIL: {
          actions: () => {
            throw new Error('Job failed');
          },
        },
      },
    },
    waiting: {},
    finished: { type: 'final' },
  },
});

type JobActor = Actor<typeof jobMachine>;
type JobSnapshot = SnapshotFrom<typeof jobMachine>;
type Hooks = Pick<typeof xstateReact, 'useActorRef'>;

const SUBSCRIBED_TO: [name: string, wrap: (actor: JobActor) => JobActor, previews: boolean][] = [
  ['a plain actor (control)', (actor) => actor, false],
  ['the proxy, without a preview (control)', (actor) => stateViewer.connect(actor), false],
  ['the proxy, while a preview shows', (actor) => stateViewer.connect(actor), true],
];

const HOOKS: [name: string, hooks: Hooks, previews: boolean][] = [
  ['@xstate/react (control)', xstateReact, false],
  ['state-viewer/xstate', stateViewer as unknown as Hooks, true],
];

/**
 * How the actor ends, what an observer that throws from complete and error hears of it, what that callback throws,
 * and the real snapshot's value afterwards.
 */
const ENDINGS: [callback: string, outcome: Outcome, heard: string[], thrown: string, value: string][] = [
  ['complete', 'FINISH', ['next:done:finished', 'complete'], 'complete failed', 'finished'],
  ['error', 'FAIL', ['error:Job failed'], 'error failed', 'running'],
];

const REJECTED = 'rejected:Actor terminated without satisfying predicate';

/**
 * Records what it hears in `calls`. With `'next'`, next throws on the done snapshot; with `'ending'`, complete and error
 * throw.
 */
function throwingObserver(calls: string[], throwing: 'next' | 'ending'): Observer<JobSnapshot> {
  return {
    next: (snapshot) => {
      calls.push(`next:${snapshot.status}:${String(snapshot.value)}`);
      if (throwing === 'next' && snapshot.status === 'done') throw new TypeError('next failed');
    },
    complete: () => {
      calls.push('complete');
      if (throwing === 'ending') throw new Error('complete failed');
    },
    error: (cause) => {
      calls.push(`error:${(cause as Error).message}`);
      if (throwing === 'ending') throw new Error('error failed');
    },
  };
}

/**
 * XState reports what an observer throws by rethrowing it from a setTimeout callback. With setTimeout faked from now
 * on, the reports wait as pending timers instead of failing the run; the returned function runs them, puts the real
 * timers back and returns the messages of what they threw.
 */
function collectReports(): () => string[] {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  return () => {
    const thrown: string[] = [];
    for (let pending = vi.getTimerCount(); pending > 0; pending--) {
      try {
        vi.advanceTimersToNextTimer();
      } catch (error) {
        thrown.push(error instanceof Error ? error.message : String(error));
      }
    }
    vi.clearAllTimers();
    vi.useRealTimers();
    return thrown;
  };
}

/**
 * Starts a job through `wrap`, lets `observe` subscribe to it and finishes the real actor. With `previews`, someone in
 * the overlay previews `waiting` first. Returns `release`, which ends that preview, as the developer would before the
 * registry's next flush, and lets the registry flush.
 */
function finishJob(
  wrap: (actor: JobActor) => JobActor,
  previews: boolean,
  observe: (ref: JobActor) => void,
): () => Promise<void> {
  const ref = wrap(createActor(jobMachine)).start();
  observe(ref);
  if (previews) registry().preview(keyOf(onlyHandle('job')), { leaves: ['waiting'] });
  realJob!.send({ type: 'FINISH' });
  return async () => {
    if (previews) registry().release();
    await flush();
    await flush();
  };
}

beforeEach(() => {
  resetRegistry();
  realJob = undefined;
  // Previews of states without a recording or fixture warn about falling back to live context.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

describe.each(SUBSCRIBED_TO)('subscribed to %s, when the actor finishes', (_name, wrap, previews) => {
  const preview = previews ? ['next:active:waiting'] : [];

  test('an observer whose next throws on the done snapshot still hears complete', async () => {
    const reported = collectReports();
    const calls: string[] = [];
    const release = finishJob(wrap, previews, (ref) => {
      ref.subscribe(throwingObserver(calls, 'next'));
    });
    // The preview holds the ending back.
    expect(calls).toEqual(previews ? preview : ['next:done:finished', 'complete']);

    await release();

    expect(calls).toEqual([...preview, 'next:done:finished', 'complete']);
    expect(reported()).toEqual(['next failed']);
  });

  test('a waitFor whose predicate throws on the final snapshot still rejects', async () => {
    const reported = collectReports();
    const checked: string[] = [];
    let settled = 'pending';
    const release = finishJob(wrap, previews, (ref) => {
      waitFor(ref, (snapshot) => {
        checked.push(`${snapshot.status}:${String(snapshot.value)}`);
        if (snapshot.status === 'done') throw new TypeError('predicate failed');
        return false;
      }).then(
        (snapshot) => (settled = `resolved:${snapshot.status}:${String(snapshot.value)}`),
        (error: Error) => (settled = `rejected:${error.message}`),
      );
    });
    // waitFor checks the snapshot it starts with; the preview holds the ending back.
    expect(checked).toEqual(['active:running', previews ? 'active:waiting' : 'done:finished']);

    await release();

    expect(checked).toEqual(['active:running', ...(previews ? ['active:waiting'] : []), 'done:finished']);
    expect(settled).toBe(REJECTED);
    expect(reported()).toEqual(['predicate failed']);
  });
});

describe.each(HOOKS)('%s: a proxy.subscribe() observer of a hook actor', (_name, hooks, previews) => {
  /**
   * Mounts the job with useActorRef, which keeps its ended actor registered while the component is mounted, so the
   * actor can still be previewed. Reports thrown from now on are collected by the returned `reported`.
   */
  async function mountJob(): Promise<{ actorRef: JobActor; calls: string[]; reported: () => string[] }> {
    let actorRef: JobActor | undefined;
    function Job() {
      actorRef = hooks.useActorRef(jobMachine);
      return null;
    }
    render(<Job />);
    await flush();
    const reported = collectReports();
    const calls: string[] = [];
    actorRef!.subscribe(throwingObserver(calls, 'ending'));
    return { actorRef: actorRef!, calls, reported };
  }

  /** Previews `waiting`, as someone in the overlay would; only the adapter registers the actor. */
  async function previewWaiting(): Promise<void> {
    if (previews) act(() => registry().preview(keyOf(onlyHandle('job')), { leaves: ['waiting'] }));
    await flush();
  }

  async function release(): Promise<void> {
    if (previews) act(() => registry().release());
    await flush();
  }

  test.each(ENDINGS)(
    'whose %s throws as the actor ends hears no preview of the ended actor afterwards',
    async (_callback, outcome, heard, thrown, value) => {
      const { actorRef, calls, reported } = await mountJob();
      act(() => realJob!.send({ type: outcome }));
      await flush();
      expect(calls).toEqual(heard);

      await previewWaiting();

      // The proxy shows the preview; the observer hears none of it.
      expect(actorRef.getSnapshot().value).toBe(previews ? 'waiting' : value);
      expect(calls).toEqual(heard);
      expect(reported()).toEqual([thrown]);
    },
  );

  test.each(ENDINGS)(
    'whose %s throws as the preview that held the ending back is released hears no preview afterwards',
    async (_callback, outcome, heard, thrown, value) => {
      const { actorRef, calls, reported } = await mountJob();
      const preview = previews ? ['next:active:waiting'] : [];
      await previewWaiting();
      // The real actor keeps running underneath the preview, which holds its ending back.
      act(() => realJob!.send({ type: outcome }));
      await flush();
      expect(calls).toEqual(previews ? preview : heard);

      await release();
      expect(calls).toEqual([...preview, ...heard]);

      await previewWaiting();

      // The proxy shows the preview again; the observer hears none of it.
      expect(actorRef.getSnapshot().value).toBe(previews ? 'waiting' : value);
      expect(calls).toEqual([...preview, ...heard]);
      expect(reported()).toEqual([thrown]);
    },
  );
});
