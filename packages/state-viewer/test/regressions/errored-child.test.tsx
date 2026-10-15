// A child machine that fails (an action throws) is stopped by XState without a final '@xstate.snapshot' inspection
// event. It must still leave the registry, like a child that finishes or is stopped.
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { createMachine, sendTo, setup, type AnyActorRef } from 'xstate';
import { useActorRef } from '../../src/xstate';
import { flush, handlesOf, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

const pingerMachine = createMachine({
  id: 'pinger',
  initial: 'waiting',
  states: { waiting: {} },
});

/** Invokes a pinger, and throws from an action on POKE. */
const flakyMachine = setup({
  types: { events: {} as { type: 'POKE' } },
  actors: { pinger: pingerMachine },
  actions: {
    explode: () => {
      throw new Error('boom');
    },
  },
}).createMachine({
  id: 'flaky',
  initial: 'running',
  states: {
    running: {
      invoke: { id: 'inner', src: 'pinger' },
      on: { POKE: { actions: 'explode' } },
    },
  },
});

/** Invokes the flaky child as "job" and handles its failure with onError. */
const supervisorMachine = setup({
  types: { events: {} as { type: 'POKE' } | { type: 'RETRY' } },
  actors: { flaky: flakyMachine },
}).createMachine({
  id: 'supervisor',
  initial: 'running',
  states: {
    running: {
      invoke: { id: 'job', src: 'flaky', onError: 'failed' },
      on: { POKE: { actions: sendTo('job', { type: 'POKE' }) } },
    },
    failed: { on: { RETRY: 'running' } },
  },
});

function Host({ onActor }: { onActor: (actor: AnyActorRef) => void }) {
  onActor(useActorRef(supervisorMachine));
  return null;
}

async function mountSupervisor() {
  let proxy: AnyActorRef | undefined;
  render(
    <Host
      onActor={(actor) => {
        proxy = actor;
      }}
    />,
  );
  await flush();
  if (!proxy) throw new Error('The supervisor did not render.');
  const actor = proxy;
  return {
    proxy: actor,
    key: keyOf(onlyHandle('supervisor')),
    send: (event: { type: 'POKE' } | { type: 'RETRY' }) => act(() => actor.send(event)),
  };
}

function registeredKeys(): string[] {
  return registry().getSnapshot().machines.map(keyOf);
}

beforeEach(() => {
  resetRegistry();
});

describe('a child machine that errors', () => {
  test('is listed while running and unregistered once its error stops it', async () => {
    const supervisor = await mountSupervisor();
    const job = (supervisor.proxy.getSnapshot() as { children: Record<string, AnyActorRef> }).children.job;
    expect(handlesOf('flaky').map((handle) => [handle.instanceId, handle.parentKey])).toEqual([
      [job.sessionId, supervisor.key],
    ]);

    supervisor.send({ type: 'POKE' });
    await flush();

    // XState stopped the child and the parent handled the error.
    expect(job.getSnapshot().status).toBe('error');
    expect(supervisor.proxy.getSnapshot().value).toBe('failed');
    expect((supervisor.proxy.getSnapshot() as { children: object }).children).toEqual({});

    expect(registeredKeys()).not.toContain(`flaky#${job.sessionId}`);
    expect(handlesOf('flaky').map(keyOf)).toEqual([]);
  });

  test('retrying after a failure lists only the new child, not every failed one', async () => {
    const supervisor = await mountSupervisor();

    supervisor.send({ type: 'POKE' });
    supervisor.send({ type: 'RETRY' });
    supervisor.send({ type: 'POKE' });
    supervisor.send({ type: 'RETRY' });
    await flush();

    const job = (supervisor.proxy.getSnapshot() as { children: Record<string, AnyActorRef> }).children.job;
    expect(supervisor.proxy.getSnapshot().value).toBe('running');
    expect(handlesOf('flaky').map((handle) => handle.instanceId)).toEqual([job.sessionId]);
  });
});
