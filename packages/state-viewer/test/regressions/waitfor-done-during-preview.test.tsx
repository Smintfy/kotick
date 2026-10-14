// waitFor(proxy, ...) called while a preview shows over an actor that already finished resolves with the done snapshot
// once the preview ends, as it does on a plain actor (spec §10.2 "Observers and the actor's ending"; R13). XState
// completes an observer that subscribes to an actor it already stopped at once; the proxy holds that back while the
// preview hides the done snapshot, then sends the done snapshot and complete, so waitFor sees the awaited final state
// rather than an actor ending without it. The preview ends through a release, which is how it ends for a hook actor
// (hooks keep a finished actor listed), or through the registry dropping the preview of a connect()ed actor, which
// unregisters when it finishes.

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { assign, createActor, createMachine, waitFor, type AnyActorRef } from 'xstate';
import { connect, useActorRef } from '../../src/xstate';
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

async function mountJob(hook: (logic: typeof jobMachine) => AnyActorRef): Promise<AnyActorRef> {
  let actorRef: AnyActorRef | undefined;
  function Job() {
    actorRef = hook(jobMachine);
    return null;
  }
  render(<Job />);
  await flush();
  if (!actorRef) throw new Error('The job did not render.');
  return actorRef;
}

/** Waits for the final state; `done` gives what waitFor settled with, as a string, so a rejection shows. */
function settledWaitFor(actorRef: AnyActorRef): { done: Promise<string>; pending: () => boolean } {
  let settled = false;
  const done = waitFor(actorRef, (snapshot) => snapshot.matches('finished')).then(
    (snapshot) => `resolved:${snapshot.status}:${String(snapshot.output)}`,
    (error: Error) => `rejected:${error.message}`,
  );
  void done.then(() => (settled = true));
  return { done, pending: () => !settled };
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

describe('waitFor on a hook actor that already finished', () => {
  test('control: @xstate/react, resolves with the done snapshot', async () => {
    const actorRef = await mountJob((logic) => xstateReact.useActorRef(logic));
    act(() => actorRef.send({ type: 'FINISH' }));

    expect(await settledWaitFor(actorRef).done).toBe('resolved:done:42');
  });

  test('control: without a preview, resolves with the done snapshot', async () => {
    const proxy = await mountJob((logic) => useActorRef(logic));
    act(() => proxy.send({ type: 'FINISH' }));

    expect(await settledWaitFor(proxy).done).toBe('resolved:done:42');
  });

  test('called while a preview shows, stays pending, and resolves with the done snapshot once released', async () => {
    const proxy = await mountJob((logic) => useActorRef(logic));
    act(() => proxy.send({ type: 'FINISH' }));
    await flush();
    act(() => registry().preview(keyOf(onlyHandle('job')), { leaves: ['waiting'] }));
    expect(proxy.getSnapshot()).toMatchObject({ status: 'active', value: 'waiting' });

    const settled = settledWaitFor(proxy);
    await flush();
    expect(settled.pending()).toBe(true);

    act(() => registry().release());

    expect(await settled.done).toBe('resolved:done:42');
  });
});

describe('waitFor on a connect()ed actor that finished during a preview', () => {
  test('called before the registry drops the preview, resolves with the done snapshot once it does', async () => {
    const actor = createActor(jobMachine).start();
    const proxy = connect(actor);
    registry().preview(keyOf(onlyHandle('job')), { leaves: ['waiting'] });
    actor.send({ type: 'FINISH' });
    expect(actor.getSnapshot().status).toBe('done');
    expect(proxy.getSnapshot()).toMatchObject({ status: 'active', value: 'waiting' });

    const settled = settledWaitFor(proxy);
    // connect() unregistered the done actor; the flush sweeps it and releases its preview.
    await flush();

    expect(registry().getSnapshot().overrides).toEqual({});
    expect(await settled.done).toBe('resolved:done:42');
  });
});
