// The actor proxy and connect() without React: actors made with createActor, connected, and previewed through the
// registry the way the overlay does it.
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import {
  Actor,
  assign,
  createActor,
  createMachine,
  emit,
  fromCallback,
  fromPromise,
  setup,
  spawnChild,
  type AnyActorRef,
} from 'xstate';
import { connect, defineFixtures } from '../../src/xstate';
import { flush, handlesOf, keyOf, onlyHandle, registry, resetRegistry } from './helpers';

type CheckoutContext = { items: number; error?: string };
type CheckoutEvent =
  | { type: 'ADD' }
  | { type: 'PAY' }
  | { type: 'FAIL'; reason: string }
  | { type: 'RETRY' }
  | { type: 'SUCCEED' }
  | { type: 'NOOP' };

const checkoutMachine = setup({
  types: { context: {} as CheckoutContext, events: {} as CheckoutEvent },
  guards: { hasItems: ({ context }) => context.items > 0 },
}).createMachine({
  id: 'checkout',
  initial: 'cart',
  context: { items: 0 },
  states: {
    cart: {
      tags: ['editable'],
      on: {
        ADD: { actions: assign({ items: ({ context }) => context.items + 1 }) },
        PAY: { guard: 'hasItems', target: 'payment' },
      },
    },
    payment: {
      initial: 'pending',
      states: {
        pending: {
          tags: ['busy'],
          on: {
            FAIL: { target: 'error', actions: assign({ error: ({ event }) => event.reason }) },
            SUCCEED: { target: '#checkout.paid' },
          },
        },
        error: {
          tags: ['failed'],
          on: { RETRY: { target: 'pending', actions: assign({ error: undefined }) } },
        },
      },
    },
    paid: { type: 'final' },
  },
});

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

let warn: MockInstance<typeof console.warn>;
const actors: AnyActorRef[] = [];

/** Keeps the actor for stopping after the test. */
function track<TActor extends AnyActorRef>(actor: TActor): TActor {
  actors.push(actor);
  return actor;
}

/** Starts and connects a checkout actor, with the instance key connect() registered it under. */
function startCheckout() {
  const actor = track(createActor(checkoutMachine).start());
  const proxy = connect(actor);
  // Instance ids come from a page-wide counter, not from the actor, so the key is read from the handle connect() just
  // registered: the last one in registration order.
  const key = keyOf(handlesOf('checkout').at(-1)!);
  return { actor, proxy, key };
}

/** Registers fixtures for the checkout machine, the way <StateViewer fixtures> does. */
function checkoutFixtures(states: Parameters<typeof defineFixtures<typeof checkoutMachine>>[1]): void {
  registry().registerFixtures([defineFixtures(checkoutMachine, states)]);
}

beforeEach(() => {
  resetRegistry();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const actor of actors.splice(0)) actor.stop();
  // Writes recordings now rather than from a timer that could fire during a later test, after its storage was
  // cleared; the next resetRegistry() clears them.
  window.dispatchEvent(new Event('pagehide'));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('connect', () => {
  test('registers the actor at once under machine.id, with a page-wide instance id rather than its session id', () => {
    const actor = track(createActor(checkoutMachine).start());
    const proxy = connect(actor);

    const handle = onlyHandle('checkout');
    expect(handle.instanceId).toMatch(/^\d+$/);
    expect(handle.instanceId).not.toBe(actor.sessionId);
    expect(handle.adapter).toBe('xstate');
    expect(handle.capabilities.preview).toBe(true);
    // The config, which machine.provide() copies share, so fixtures defined for the machine match them.
    expect(handle.source).toBe(checkoutMachine.config);
    expect(handle.label).toBeUndefined();
    expect(handle.parentKey).toBeUndefined();
    expect(handle.getActiveLeaves()).toEqual(['cart']);

    // The key it's registered under is the one its proxy follows previews at.
    registry().preview(keyOf(handle), { leaves: ['payment.error'] });
    expect(proxy.getSnapshot().value).toEqual({ payment: 'error' });
  });

  test('stays registered after the batched flush', async () => {
    const { key } = startCheckout();
    await flush();

    expect(handlesOf('checkout').map(keyOf)).toEqual([key]);
  });

  test('uses the id and label options', () => {
    const actor = track(createActor(checkoutMachine).start());
    connect(actor, { id: 'header-cart', label: 'Header cart' });

    const handle = onlyHandle('header-cart');
    expect(handle.label).toBe('Header cart');
    expect(handle.instanceId).toMatch(/^\d+$/);
    expect(handlesOf('checkout')).toEqual([]);
  });

  test('gives every connected actor of a machine its own instance', () => {
    const first = startCheckout();
    const second = startCheckout();

    expect(first.key).not.toBe(second.key);
    expect(handlesOf('checkout').map(keyOf)).toEqual([first.key, second.key]);
  });

  test('returns a proxy that is still an Actor, not the actor itself', () => {
    const { actor, proxy } = startCheckout();

    expect(proxy).not.toBe(actor);
    expect(proxy).toBeInstanceOf(Actor);
    expect(proxy.constructor).toBe(Actor);
  });

  test('connecting the same actor again returns the same proxy and registers once', () => {
    const register = vi.spyOn(registry(), 'register');
    const actor = track(createActor(checkoutMachine).start());

    const proxy = connect(actor);
    expect(connect(actor)).toBe(proxy);
    expect(connect(proxy)).toBe(proxy);

    expect(register).toHaveBeenCalledTimes(1);
    expect(handlesOf('checkout')).toHaveLength(1);
  });

  test('returns actors that are not machines unchanged, without registering them', () => {
    const promise = track(createActor(fromPromise(() => new Promise<void>(() => {}))).start());
    const callback = track(createActor(fromCallback(() => () => {})).start());

    expect(connect(promise, { id: 'promise' })).toBe(promise);
    expect(connect(callback, { id: 'callback' })).toBe(callback);
    expect(registry().getSnapshot().machines).toEqual([]);
  });

  test('returns the actor unchanged when disabled', () => {
    const actor = track(createActor(checkoutMachine).start());

    expect(connect(actor, { disabled: true })).toBe(actor);
    expect(registry().getSnapshot().machines).toEqual([]);
  });

  test('returns an actor that already stopped unchanged', () => {
    const actor = createActor(checkoutMachine).start();
    actor.stop();

    expect(connect(actor)).toBe(actor);
    expect(registry().getSnapshot().machines).toEqual([]);
  });

  test('returns an actor that already reached its final state unchanged', () => {
    const actor = createActor(checkoutMachine).start();
    actor.send({ type: 'ADD' });
    actor.send({ type: 'PAY' });
    actor.send({ type: 'SUCCEED' });
    expect(actor.getSnapshot().status).toBe('done');

    expect(connect(actor)).toBe(actor);
    expect(registry().getSnapshot().machines).toEqual([]);
  });

  test('unregisters when the actor stops, and drops its preview at the flush', async () => {
    const { actor, key } = startCheckout();
    registry().preview(key, { leaves: ['payment.error'] });
    expect(registry().getOverride(key)).toBeDefined();

    actor.stop();
    expect(handlesOf('checkout')).toEqual([]);

    await flush();
    expect(handlesOf('checkout')).toEqual([]);
    expect(registry().getOverride(key)).toBeUndefined();
  });

  test('unregisters when stopped through the proxy', async () => {
    const { actor, proxy } = startCheckout();

    proxy.stop();
    await flush();

    expect(actor.getSnapshot().status).toBe('stopped');
    expect(handlesOf('checkout')).toEqual([]);
  });

  test('unregisters when the actor reaches a top-level final state', async () => {
    const { actor, proxy } = startCheckout();
    proxy.send({ type: 'ADD' });
    proxy.send({ type: 'PAY' });
    expect(handlesOf('checkout')).toHaveLength(1);

    proxy.send({ type: 'SUCCEED' });
    await flush();

    expect(actor.getSnapshot().status).toBe('done');
    expect(handlesOf('checkout')).toEqual([]);
  });

  test('an actor connected before it starts is registered, and proxy.start() starts it and returns the proxy', () => {
    const actor = track(createActor(checkoutMachine));
    const proxy = connect(actor);
    expect(onlyHandle('checkout').instanceId).toMatch(/^\d+$/);
    const key = keyOf(onlyHandle('checkout'));

    expect(proxy.start()).toBe(proxy);
    proxy.send({ type: 'ADD' });

    expect(actor.getSnapshot().context.items).toBe(1);
    // Starting keeps the instance it was registered as.
    expect(handlesOf('checkout').map(keyOf)).toEqual([key]);
  });
});

describe('getSnapshot', () => {
  test('returns the real snapshot when nothing is previewed', () => {
    const { actor, proxy } = startCheckout();
    expect(proxy.getSnapshot()).toBe(actor.getSnapshot());

    actor.send({ type: 'ADD' });
    expect(proxy.getSnapshot()).toBe(actor.getSnapshot());
  });

  test('returns a forced snapshot of the previewed state, the same object on every call', () => {
    const { actor, proxy, key } = startCheckout();
    const real = actor.getSnapshot();

    registry().preview(key, { leaves: ['payment.error'] });
    const forced = proxy.getSnapshot();

    expect(forced).not.toBe(real);
    expect(forced.value).toEqual({ payment: 'error' });
    expect(proxy.getSnapshot()).toBe(forced);
    expect(proxy.getSnapshot()).toBe(forced);
    expect(actor.getSnapshot()).toBe(real);
    expect(actor.getSnapshot().value).toBe('cart');
  });

  test('keeps the same forced snapshot while the real actor transitions underneath', () => {
    const { actor, proxy, key } = startCheckout();
    registry().preview(key, { leaves: ['payment.error'] });
    const forced = proxy.getSnapshot();

    actor.send({ type: 'ADD' });
    actor.send({ type: 'PAY' });

    expect(actor.getSnapshot().value).toEqual({ payment: 'pending' });
    expect(proxy.getSnapshot()).toBe(forced);
  });

  test('a new override gives a new forced snapshot, even for the same leaves', () => {
    const { proxy, key } = startCheckout();

    registry().preview(key, { leaves: ['payment.error'] });
    const error = proxy.getSnapshot();
    registry().preview(key, { leaves: ['payment.pending'] });
    const pending = proxy.getSnapshot();
    registry().preview(key, { leaves: ['payment.error'] });
    const errorAgain = proxy.getSnapshot();

    expect(pending).not.toBe(error);
    expect(pending.value).toEqual({ payment: 'pending' });
    expect(errorAgain).not.toBe(error);
    expect(errorAgain.value).toEqual({ payment: 'error' });
  });

  test('takes its context from the override', () => {
    const declined = { items: 3, error: 'Card declined' };
    checkoutFixtures({ 'payment.error': { context: declined } });
    const { actor, proxy, key } = startCheckout();

    registry().preview(key, { leaves: ['payment.error'] });

    expect(registry().getOverride(key)).toMatchObject({ source: 'fixture', context: declined });
    expect(proxy.getSnapshot().context).toBe(declined);
    expect(actor.getSnapshot().context).toEqual({ items: 0 });
  });

  test('falls back to the live context with a warning when there is no recording or fixture', () => {
    const { actor, proxy, key } = startCheckout();
    actor.send({ type: 'ADD' });
    const live = actor.getSnapshot().context;

    registry().preview(key, { leaves: ['payment.error'] });

    expect(registry().getOverride(key)?.source).toBe('live');
    expect(proxy.getSnapshot().context).toBe(live);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('uses the live context'));
  });

  test('matches, hasTag, can and status behave like a real snapshot', () => {
    checkoutFixtures({ 'payment.error': { context: { items: 1, error: 'Card declined' } } });
    const { proxy, key } = startCheckout();

    registry().preview(key, { leaves: ['payment.error'] });
    const forced = proxy.getSnapshot();

    expect(forced.status).toBe('active');
    expect(forced.matches('payment')).toBe(true);
    expect(forced.matches({ payment: 'error' })).toBe(true);
    expect(forced.matches({ payment: 'pending' })).toBe(false);
    expect(forced.matches('cart')).toBe(false);
    expect(forced.hasTag('failed')).toBe(true);
    expect(forced.hasTag('editable')).toBe(false);
    expect(forced.can({ type: 'RETRY' })).toBe(true);
    expect(forced.can({ type: 'ADD' })).toBe(false);
  });

  test('can evaluates guards against the previewed context, not the real one', () => {
    checkoutFixtures({ cart: { context: { items: 2 } } });
    const { actor, proxy, key } = startCheckout();

    registry().preview(key, { leaves: ['cart'], source: 'fixture' });
    expect(proxy.getSnapshot().can({ type: 'PAY' })).toBe(true);
    expect(actor.getSnapshot().can({ type: 'PAY' })).toBe(false);

    registry().preview(key, { leaves: ['cart'], source: 'live' });
    expect(proxy.getSnapshot().can({ type: 'PAY' })).toBe(false);
  });

  test('a previewed final state has status done while the real actor keeps running and stays registered', async () => {
    const { actor, proxy, key } = startCheckout();

    registry().preview(key, { leaves: ['paid'] });
    await flush();

    expect(proxy.getSnapshot().status).toBe('done');
    expect(proxy.getSnapshot().matches('paid')).toBe(true);
    expect(actor.getSnapshot().status).toBe('active');
    expect(handlesOf('checkout')).toHaveLength(1);
  });

  test('release restores the real current snapshot, including transitions made during the preview', () => {
    const { actor, proxy, key } = startCheckout();
    registry().preview(key, { leaves: ['payment.error'] });

    actor.send({ type: 'ADD' });
    actor.send({ type: 'ADD' });
    actor.send({ type: 'PAY' });
    registry().release(key);

    expect(proxy.getSnapshot()).toBe(actor.getSnapshot());
    expect(proxy.getSnapshot().value).toEqual({ payment: 'pending' });
    expect(proxy.getSnapshot().context).toEqual({ items: 2 });
  });

  test('releasing every preview restores the real snapshot', () => {
    const { actor, proxy, key } = startCheckout();
    registry().preview(key, { leaves: ['payment.error'] });

    registry().release();

    expect(proxy.getSnapshot()).toBe(actor.getSnapshot());
  });

  test("a preview of one instance leaves another instance's proxy alone", () => {
    const first = startCheckout();
    const second = startCheckout();

    registry().preview(first.key, { leaves: ['payment.error'] });

    expect(first.proxy.getSnapshot().value).toEqual({ payment: 'error' });
    expect(second.proxy.getSnapshot()).toBe(second.actor.getSnapshot());
  });

  test('getSnapshot works when taken off the proxy', () => {
    const { proxy, key } = startCheckout();
    const { getSnapshot } = proxy;

    registry().preview(key, { leaves: ['payment.error'] });

    expect(getSnapshot()).toBe(proxy.getSnapshot());
  });

  test('shows the real snapshot, warning once, when the override names states this machine does not have', () => {
    const { actor, proxy, key } = startCheckout();
    // Another handle under the same key with another tree, as when HMR replaces the machine.
    registry().register({
      ...onlyHandle('checkout'),
      describe: () => [{ id: 'gone', key: 'gone', type: 'atomic', children: [] }],
      normalizeTarget: (leaves) => leaves,
    });
    registry().preview(key, { leaves: ['gone'] });
    expect(registry().getOverride(key)?.leaves).toEqual(['gone']);
    const shown: unknown[] = [];
    proxy.subscribe((snapshot) => shown.push(snapshot));
    warn.mockClear();

    expect(proxy.getSnapshot()).toBe(actor.getSnapshot());
    expect(proxy.getSnapshot()).toBe(actor.getSnapshot());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Can't show the preview"), expect.any(Error));

    // What's shown is the real snapshot, so its updates reach subscribers.
    actor.send({ type: 'ADD' });
    expect(shown).toEqual([actor.getSnapshot()]);
    expect(proxy.getSnapshot().context.items).toBe(1);
  });
});

describe('subscribe', () => {
  test('forwards every real emission without a preview, the same ones the real actor sends, repeats included', () => {
    const { actor, proxy } = startCheckout();
    const real: unknown[] = [];
    const shown: unknown[] = [];
    actor.subscribe((snapshot) => real.push(snapshot));
    proxy.subscribe((snapshot) => shown.push(snapshot));

    proxy.send({ type: 'ADD' });
    // Not handled anywhere: XState still emits, with the snapshot it already had.
    proxy.send({ type: 'NOOP' });
    proxy.send({ type: 'PAY' });

    expect(real).toHaveLength(3);
    expect(real[1]).toBe(real[0]);
    expect(shown).toHaveLength(real.length);
    shown.forEach((snapshot, index) => expect(snapshot).toBe(real[index]));
  });

  test('takes an observer object', () => {
    const { actor, proxy } = startCheckout();
    const next = vi.fn();
    const complete = vi.fn();

    proxy.subscribe({ next, complete });
    proxy.send({ type: 'ADD' });
    expect(next).toHaveBeenCalledWith(actor.getSnapshot());

    actor.stop();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  test('calls an observer object with itself as this', () => {
    const { proxy } = startCheckout();
    const observer = {
      seen: [] as unknown[],
      next(snapshot: unknown) {
        this.seen.push(snapshot);
      },
    };

    proxy.subscribe(observer);
    proxy.send({ type: 'ADD' });

    expect(observer.seen).toHaveLength(1);
  });

  test('takes next, error and complete callbacks as separate arguments', () => {
    const { actor, proxy } = startCheckout();
    const next = vi.fn();
    const error = vi.fn();
    const complete = vi.fn();

    proxy.subscribe(next, error, complete);
    proxy.send({ type: 'ADD' });
    proxy.send({ type: 'PAY' });
    proxy.send({ type: 'SUCCEED' });

    expect(next).toHaveBeenCalledTimes(3);
    expect(next).toHaveBeenLastCalledWith(actor.getSnapshot());
    expect(actor.getSnapshot().status).toBe('done');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  test('delivers getSnapshot() when a preview starts, changes and is released', () => {
    const { actor, proxy, key } = startCheckout();
    const shown: unknown[] = [];
    proxy.subscribe((snapshot) => shown.push(snapshot));

    registry().preview(key, { leaves: ['payment.error'] });
    expect(shown).toEqual([proxy.getSnapshot()]);
    expect(shown[0]).toBe(proxy.getSnapshot());

    registry().preview(key, { leaves: ['payment.pending'] });
    expect(shown).toHaveLength(2);
    expect(shown[1]).toBe(proxy.getSnapshot());

    registry().release(key);
    expect(shown).toHaveLength(3);
    expect(shown[2]).toBe(actor.getSnapshot());
  });

  test('does not forward real updates during a preview', () => {
    const { actor, proxy, key } = startCheckout();
    const shown: unknown[] = [];
    proxy.subscribe((snapshot) => shown.push(snapshot));
    registry().preview(key, { leaves: ['payment.error'] });
    const forced = proxy.getSnapshot();

    actor.send({ type: 'ADD' });
    actor.send({ type: 'NOOP' });
    actor.send({ type: 'PAY' });

    expect(shown).toEqual([forced]);

    registry().release(key);
    expect(shown).toHaveLength(2);
    expect(shown[1]).toBe(actor.getSnapshot());
    expect(actor.getSnapshot().value).toEqual({ payment: 'pending' });
  });

  test('an observer subscribed during a preview never receives the real snapshot', () => {
    const { actor, proxy, key } = startCheckout();
    registry().preview(key, { leaves: ['payment.error'] });
    const forced = proxy.getSnapshot();
    const shown: unknown[] = [];
    proxy.subscribe((snapshot) => shown.push(snapshot));

    actor.send({ type: 'ADD' });
    actor.send({ type: 'ADD' });

    expect(shown.length).toBeLessThanOrEqual(1);
    for (const snapshot of shown) expect(snapshot).toBe(forced);
  });

  test('previewing the same leaves the real actor is in still notifies, with the forced snapshot', () => {
    const { actor, proxy, key } = startCheckout();
    const shown: unknown[] = [];
    proxy.subscribe((snapshot) => shown.push(snapshot));

    registry().preview(key, { leaves: ['cart'] });

    expect(shown).toHaveLength(1);
    expect(shown[0]).toBe(proxy.getSnapshot());
    expect(shown[0]).not.toBe(actor.getSnapshot());
  });

  test('unsubscribe stops both real updates and preview notifications, and is safe to call twice', () => {
    const { proxy, key } = startCheckout();
    const stopped = vi.fn();
    const kept = vi.fn();
    const subscription = proxy.subscribe(stopped);
    proxy.subscribe(kept);

    subscription.unsubscribe();
    proxy.send({ type: 'ADD' });
    registry().preview(key, { leaves: ['payment.error'] });
    registry().release(key);
    expect(() => subscription.unsubscribe()).not.toThrow();

    expect(stopped).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(3);
  });

  test('a second unsubscribe leaves a later subscription of the same function alone', () => {
    const { proxy, key } = startCheckout();
    const listener = vi.fn();
    const first = proxy.subscribe(listener);
    first.unsubscribe();
    proxy.subscribe(listener);

    first.unsubscribe();
    registry().preview(key, { leaves: ['payment.error'] });
    proxy.send({ type: 'ADD' });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('completes observers when the actor is stopped during a preview', async () => {
    const { proxy, key } = startCheckout();
    const complete = vi.fn();
    proxy.subscribe({ complete });
    registry().preview(key, { leaves: ['payment.error'] });

    proxy.stop();
    await flush();

    expect(complete).toHaveBeenCalledTimes(1);
  });
});

describe('error reporting', () => {
  const faultyMachine = createMachine({
    id: 'faulty',
    initial: 'idle',
    states: {
      idle: {
        on: {
          BOOM: {
            actions: () => {
              throw new Error('boom');
            },
          },
        },
      },
    },
  });

  // XState reports an error as unhandled by throwing it from a setTimeout callback, so fake timers catch the throw.
  // Switching back to real timers after the test drops a report a test leaves pending.
  function startFaulty() {
    vi.useFakeTimers();
    return track(createActor(faultyMachine).start());
  }

  test('a real actor observed with only a next callback reports the error as unhandled (baseline)', () => {
    const actor = startFaulty();
    actor.subscribe(() => {});

    actor.send({ type: 'BOOM' });

    expect(() => vi.runAllTimers()).toThrow('boom');
  });

  test('a real actor observed with an error callback does not report the error as unhandled (baseline)', () => {
    const actor = startFaulty();
    const error = vi.fn();
    actor.subscribe({ error });

    actor.send({ type: 'BOOM' });

    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
    expect(() => vi.runAllTimers()).not.toThrow();
  });

  test('observed through the proxy with only a next callback, the error is still reported as unhandled', () => {
    const proxy = connect(startFaulty());
    const next = vi.fn();
    proxy.subscribe(next);

    proxy.send({ type: 'BOOM' });

    expect(() => vi.runAllTimers()).toThrow('boom');
    expect(next).not.toHaveBeenCalled();
  });

  test('observed through the proxy with an observer object without error, the error is still reported', () => {
    const proxy = connect(startFaulty());
    proxy.subscribe({ next: () => {}, complete: () => {} });

    proxy.send({ type: 'BOOM' });

    expect(() => vi.runAllTimers()).toThrow('boom');
  });

  test('connected but not observed by the app, the error is reported as unhandled, as without connect', () => {
    const proxy = connect(startFaulty());

    proxy.send({ type: 'BOOM' });

    expect(() => vi.runAllTimers()).toThrow('boom');
  });

  test("the proxy passes the error to the observer's error callback, and not to complete", () => {
    const proxy = connect(startFaulty());
    const error = vi.fn();
    const complete = vi.fn();
    proxy.subscribe({ error, complete });

    proxy.send({ type: 'BOOM' });

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
    expect(complete).not.toHaveBeenCalled();
  });

  // connect() watches the actor through inspection rather than an observer, which would change how XState reports it.
  test('an error the app handles through the proxy is not reported as unhandled, as with the real actor', () => {
    const proxy = connect(startFaulty());
    const error = vi.fn();
    proxy.subscribe({ error });

    proxy.send({ type: 'BOOM' });

    expect(error).toHaveBeenCalledTimes(1);
    expect(() => vi.runAllTimers()).not.toThrow();
  });

  // Same reason: an observer added by connect() would decide whether errors handled on the real actor are reported.
  test('connecting an actor leaves an error the app handles on the real actor unreported', () => {
    const actor = startFaulty();
    connect(actor);
    const error = vi.fn();
    actor.subscribe({ error });

    actor.send({ type: 'BOOM' });

    expect(error).toHaveBeenCalledTimes(1);
    expect(() => vi.runAllTimers()).not.toThrow();
  });
});

describe('passthrough', () => {
  test("exposes the real actor's id, sessionId, system and logic", () => {
    const actor = track(createActor(checkoutMachine, { id: 'main-checkout' }).start());
    const proxy = connect(actor);

    expect(proxy.id).toBe('main-checkout');
    expect(proxy.sessionId).toBe(actor.sessionId);
    expect(proxy.system).toBe(actor.system);
    expect(proxy.logic).toBe(checkoutMachine);
  });

  test('on() listens for emitted events and is the same function on every read', () => {
    const pingMachine = setup({
      types: { events: {} as { type: 'PING' }, emitted: {} as { type: 'pong'; at: number } },
    }).createMachine({
      id: 'ping',
      on: { PING: { actions: emit({ type: 'pong', at: 1 }) } },
    });
    const actor = track(createActor(pingMachine).start());
    const proxy = connect(actor);
    const handler = vi.fn();

    expect(proxy.on).toBe(proxy.on);
    const { on } = proxy;
    const subscription = on('pong', handler);
    proxy.send({ type: 'PING' });
    expect(handler).toHaveBeenCalledWith({ type: 'pong', at: 1 });

    subscription.unsubscribe();
    proxy.send({ type: 'PING' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('the overridden members are the same function on every read', () => {
    const { proxy } = startCheckout();

    expect(proxy.getSnapshot).toBe(proxy.getSnapshot);
    expect(proxy.subscribe).toBe(proxy.subscribe);
    expect(proxy.send).toBe(proxy.send);
    expect(proxy.select).toBe(proxy.select);
    expect(proxy.start).toBe(proxy.start);
    expect(proxy.stop).toBe(proxy.stop);
  });

  test('getPersistedSnapshot and toJSON come from the real actor, also during a preview', () => {
    const { actor, proxy, key } = startCheckout();
    proxy.send({ type: 'ADD' });
    registry().preview(key, { leaves: ['payment.error'] });

    expect(proxy.getPersistedSnapshot()).toEqual(actor.getPersistedSnapshot());
    expect(proxy.getPersistedSnapshot()).toMatchObject({ value: 'cart', context: { items: 1 } });
    expect(proxy.toJSON()).toEqual(actor.toJSON());
    expect(JSON.stringify({ ref: proxy })).toBe(JSON.stringify({ ref: actor }));
  });

  test('start() and stop() return the proxy', () => {
    const { actor, proxy } = startCheckout();

    expect(proxy.start()).toBe(proxy);
    expect(actor.getSnapshot().status).toBe('active');
    expect(proxy.stop()).toBe(proxy);
    expect(actor.getSnapshot().status).toBe('stopped');
  });

  test('the observable interop method returns the proxy', () => {
    const { proxy } = startCheckout();
    // The key XState uses, Symbol.observable when something defines it.
    const key = (Symbol as { observable?: symbol }).observable ?? '@@observable';

    const observable = (proxy as unknown as Record<PropertyKey, () => unknown>)[key]();

    expect(observable).toBe(proxy);
  });

  test('select().get() follows the preview', () => {
    const { proxy, key } = startCheckout();
    const value = proxy.select((snapshot) => snapshot.value);

    expect(value.get()).toBe('cart');
    registry().preview(key, { leaves: ['payment.error'] });
    expect(value.get()).toEqual({ payment: 'error' });
    registry().release(key);
    expect(value.get()).toBe('cart');
  });

  test('select().subscribe() follows the preview and only reports changed selections', () => {
    checkoutFixtures({ cart: { context: { items: 5 } } });
    const { actor, proxy, key } = startCheckout();
    const items: number[] = [];
    const subscription = proxy.select((snapshot) => snapshot.context.items).subscribe((count) => items.push(count));

    proxy.send({ type: 'ADD' });
    expect(items).toEqual([1]);

    registry().preview(key, { leaves: ['cart'], source: 'fixture' });
    expect(items).toEqual([1, 5]);

    // The real actor keeps counting underneath, unseen.
    actor.send({ type: 'ADD' });
    expect(items).toEqual([1, 5]);

    registry().release(key);
    expect(items).toEqual([1, 5, 2]);

    subscription.unsubscribe();
    proxy.send({ type: 'ADD' });
    expect(items).toEqual([1, 5, 2]);
  });

  test('select() with an equality function skips selections it considers equal', () => {
    const { proxy, key } = startCheckout();
    const tags = vi.fn();
    proxy
      .select(
        (snapshot) => [...snapshot.tags].sort(),
        (a, b) => a.join() === b.join(),
      )
      .subscribe(tags);

    // Same tags as the real state, so nothing to report.
    registry().preview(key, { leaves: ['cart'] });
    expect(tags).not.toHaveBeenCalled();

    registry().preview(key, { leaves: ['payment.error'] });
    expect(tags).toHaveBeenCalledWith(['failed']);
  });
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
