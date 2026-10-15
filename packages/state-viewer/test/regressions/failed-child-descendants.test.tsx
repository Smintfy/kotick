// When a child machine fails, XState stops it but leaves its own children running, out of reach of the tree. Those
// children leave the registry along with the failed child and aren't listed again, not even when they keep emitting
// snapshots (a delayed transition, here), since a child is only listed under a parent that is. A
// child that fails while starting, after its own invoked child started, isn't listed, and neither is that child.

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createMachine, sendTo, setup, type AnyActorRef, type InspectionEvent } from 'xstate';
import { useActorRef } from '../../src/xstate';
import { flush, handlesOf, keyOf, registry, resetRegistry } from '../xstate/helpers';

/** Ticks between two states every 100ms, on its own. */
const tickerMachine = createMachine({
  id: 'ticker',
  initial: 'tick',
  states: {
    tick: { after: { 100: 'tock' } },
    tock: { after: { 100: 'tick' } },
  },
});

/** Invokes a ticker, and throws from an action on POKE. */
const flakyMachine = setup({
  types: { events: {} as { type: 'POKE' } },
  actors: { ticker: tickerMachine },
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
      invoke: { id: 'inner', src: 'ticker' },
      on: { POKE: { actions: 'explode' } },
    },
  },
});

/** Invokes a ticker, and throws from its initial entry action, so it fails while starting. */
const brokenMachine = setup({
  actors: { ticker: tickerMachine },
  actions: {
    explode: () => {
      throw new Error('boom on start');
    },
  },
}).createMachine({
  id: 'broken',
  initial: 'running',
  states: {
    running: {
      entry: 'explode',
      invoke: { id: 'inner', src: 'ticker' },
    },
  },
});

/** Invokes the flaky child as "job" and handles its failure with onError. */
const supervisorMachine = setup({
  types: { events: {} as { type: 'POKE' } | { type: 'START_BROKEN' } },
  actors: { flaky: flakyMachine, broken: brokenMachine },
}).createMachine({
  id: 'supervisor',
  initial: 'running',
  states: {
    running: {
      invoke: { id: 'job', src: 'flaky', onError: 'failed' },
      on: {
        POKE: { actions: sendTo('job', { type: 'POKE' }) },
        START_BROKEN: 'trying',
      },
    },
    failed: {},
    trying: {
      invoke: { id: 'broken-job', src: 'broken', onError: 'failed' },
    },
  },
});

/** Ticker actors created in the supervisor's system, found through inspection, since a failed parent hides them. */
const tickers: AnyActorRef[] = [];

function inspect(event: InspectionEvent): void {
  if (event.type === '@xstate.actor' && (event.actorRef as { logic?: unknown }).logic === tickerMachine) {
    tickers.push(event.actorRef as AnyActorRef);
  }
}

function Host({ onActor }: { onActor: (actor: AnyActorRef) => void }) {
  onActor(useActorRef(supervisorMachine, { inspect }));
  return null;
}

async function mountSupervisor() {
  let proxy: AnyActorRef | undefined;
  render(<Host onActor={(actor) => (proxy = actor)} />);
  await flush();
  if (!proxy) throw new Error('The supervisor did not render.');
  return proxy;
}

/** Handles whose parentKey names no registered handle. */
function orphans() {
  const machines = registry().getSnapshot().machines;
  const keys = new Set(machines.map(keyOf));
  return machines.filter((handle) => handle.parentKey !== undefined && !keys.has(handle.parentKey)).map(keyOf);
}

beforeEach(() => {
  resetRegistry();
  tickers.length = 0;
  // The ticker's delayed transitions run on fake timers.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the children of a child machine that fails', () => {
  test('leave the list with their failed parent and stay off it while they keep running', async () => {
    const supervisor = await mountSupervisor();
    expect(handlesOf('ticker')).toHaveLength(1);
    const job = (supervisor.getSnapshot() as { children: Record<string, AnyActorRef> }).children.job;
    const ticker = (job.getSnapshot() as { children: Record<string, AnyActorRef> }).children.inner;

    act(() => supervisor.send({ type: 'POKE' }));
    await flush();
    expect(supervisor.getSnapshot().value).toBe('failed');
    expect(handlesOf('flaky')).toEqual([]);
    // The ticker left the list with its failed parent.
    expect(handlesOf('ticker')).toEqual([]);

    // XState left the ticker running, and its next tick doesn't list it again.
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    await flush();
    expect(ticker.getSnapshot()).toMatchObject({ status: 'active', value: 'tock' });
    expect(orphans()).toEqual([]);
    expect(handlesOf('ticker')).toEqual([]);
  });

  test('are not listed when their parent fails while starting', async () => {
    const supervisor = await mountSupervisor();
    tickers.length = 0;
    act(() => supervisor.send({ type: 'START_BROKEN' }));
    await flush();
    expect(supervisor.getSnapshot().value).toBe('failed');
    expect(handlesOf('broken')).toEqual([]);
    expect(orphans()).toEqual([]);
    expect(handlesOf('ticker')).toEqual([]);

    // The broken child's ticker started before its parent failed, and XState left it running; it stays off the list.
    expect(tickers).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    await flush();
    expect(tickers[0].getSnapshot()).toMatchObject({ status: 'active', value: 'tock' });
    expect(orphans()).toEqual([]);
    expect(handlesOf('ticker')).toEqual([]);
  });
});
