// Children in the snapshots of the actor proxy, without React: actors made with createActor, connected, and previewed
// through the registry the way the overlay does it.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createActor, createMachine, setup, spawnChild, type AnyActorRef } from 'xstate';
import { connect } from '../../src/xstate';
import { keyOf, onlyHandle, registry, resetRegistry } from './helpers';

const timerMachine = createMachine({ id: 'timer', initial: 'running', states: { running: {} } });

/** Invokes a child machine while `active`. */
const parentMachine = setup({ actors: { timer: timerMachine } }).createMachine({
  id: 'parent',
  initial: 'active',
  states: {
    active: { tags: ['live'], invoke: { src: 'timer', id: 'timer' }, on: { PAUSE: 'paused' } },
    paused: { tags: ['idle'], on: { RESUME: 'active' } },
  },
});

/** Spawns a child machine on start, which outlives every state change. */
const spawnerMachine = setup({ actors: { timer: timerMachine } }).createMachine({
  id: 'spawner',
  initial: 'idle',
  entry: spawnChild('timer', { id: 'spawned' }),
  states: {
    idle: { on: { WORK: 'busy' } },
    busy: { tags: ['working'], on: { REST: 'idle' } },
  },
});

const actors: AnyActorRef[] = [];

/** Keeps the actor for stopping after the test. */
function track<TActor extends AnyActorRef>(actor: TActor): TActor {
  actors.push(actor);
  return actor;
}

beforeEach(() => {
  resetRegistry();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const actor of actors.splice(0)) actor.stop();
  // Writes recordings now rather than from a timer that could fire during a later test, after its storage was
  // cleared; the next resetRegistry() clears them.
  window.dispatchEvent(new Event('pagehide'));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('children carry-over', () => {
  test('a preview of another state carries over the live children', () => {
    const actor = track(createActor(parentMachine).start());
    const proxy = connect(actor);
    const timer = actor.getSnapshot().children.timer;
    expect(timer).toBeDefined();

    registry().preview(keyOf(onlyHandle('parent')), { leaves: ['paused'] });
    const forced = proxy.getSnapshot();

    expect(forced.value).toBe('paused');
    expect(Object.keys(forced.children)).toEqual(['timer']);
    expect(forced.children.timer).toBe(timer);
    expect(proxy.getSnapshot()).toBe(forced);
  });

  test('matches, hasTag, can and status still work on the snapshot with copied children', () => {
    const actor = track(createActor(parentMachine).start());
    const proxy = connect(actor);

    registry().preview(keyOf(onlyHandle('parent')), { leaves: ['paused'] });
    const forced = proxy.getSnapshot();

    expect(forced.children.timer).toBeDefined();
    expect(forced.status).toBe('active');
    expect(forced.matches('paused')).toBe(true);
    expect(forced.matches('active')).toBe(false);
    expect(forced.hasTag('idle')).toBe(true);
    expect(forced.hasTag('live')).toBe(false);
    expect(forced.can({ type: 'RESUME' })).toBe(true);
    expect(forced.can({ type: 'PAUSE' })).toBe(false);
  });

  test('spawned children are carried over too', () => {
    const actor = track(createActor(spawnerMachine).start());
    const proxy = connect(actor);
    const spawned = actor.getSnapshot().children.spawned;
    expect(spawned).toBeDefined();

    registry().preview(keyOf(onlyHandle('spawner')), { leaves: ['busy'] });
    const forced = proxy.getSnapshot();

    expect(forced.children.spawned).toBe(spawned);
    expect(forced.matches('busy')).toBe(true);
    expect(forced.hasTag('working')).toBe(true);
    expect(forced.can({ type: 'REST' })).toBe(true);
    expect(forced.can({ type: 'WORK' })).toBe(false);
  });

  test('without live children the forced snapshot is the plain resolved one', () => {
    const actor = track(createActor(parentMachine).start());
    const proxy = connect(actor);
    actor.send({ type: 'PAUSE' });
    expect(actor.getSnapshot().children).toEqual({});

    registry().preview(keyOf(onlyHandle('parent')), { leaves: ['active'] });
    const forced = proxy.getSnapshot();

    expect(forced.children).toEqual({});
    expect(forced.children).not.toBe(actor.getSnapshot().children);
    expect(forced).toStrictEqual(parentMachine.resolveState({ value: 'active', context: forced.context }));
    expect(forced.matches('active')).toBe(true);
  });

  test('a change in the live children gives a new forced snapshot and notifies subscribers', () => {
    const actor = track(createActor(parentMachine).start());
    const proxy = connect(actor);
    const shown: unknown[] = [];
    proxy.subscribe((snapshot) => shown.push(snapshot));
    registry().preview(keyOf(onlyHandle('parent')), { leaves: ['paused'] });
    const withTimer = proxy.getSnapshot();
    expect(shown).toEqual([withTimer]);

    // The real actor leaves `active`, which stops the invoked timer.
    actor.send({ type: 'PAUSE' });
    const withoutChildren = proxy.getSnapshot();
    expect(withoutChildren).not.toBe(withTimer);
    expect(withoutChildren.children).toEqual({});
    expect(withoutChildren.value).toBe('paused');
    expect(shown).toHaveLength(2);
    expect(shown[1]).toBe(withoutChildren);

    // Back in `active`, with a new timer.
    actor.send({ type: 'RESUME' });
    const withNewTimer = proxy.getSnapshot();
    expect(withNewTimer.children.timer).toBe(actor.getSnapshot().children.timer);
    expect(withNewTimer.children.timer).not.toBe(withTimer.children.timer);
    expect(shown).toHaveLength(3);
    expect(shown[2]).toBe(withNewTimer);
  });
});
