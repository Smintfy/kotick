// The actor proxy: what consumers hold in place of the real actor.

import { toObserver, type AnyActorRef, type AnyMachineSnapshot, type Observer } from 'xstate';
import { callListener, getRegistry, toInstanceKey } from '../core/registry';
import type { MachineHandle, Override } from '../core/types';
import { EMPTY_CHILDREN, liveChildren, statusOf, type MachineActor } from './actor';
import { createHandle, inspect } from './handle';
import { isFallbackId, warnFallbackId, type Identity } from './identity';
import { resolveSnapshot } from './tree';
import { createView, type View, type ViewSource } from './view';

/** One identity of an actor in the registry. A new label or id makes a new one; the proxy stays the same. */
export interface Registration {
  readonly key: string;
  readonly handle: MachineHandle;
  /**
   * Points the proxy at this registration's key, registers the handle, records the current snapshot and every later
   * one, and lists child machines. Returns the cleanup, which unregisters. With `untilStopped`, the cleanup also runs
   * once the actor is done or stopped.
   */
  connect(options?: { untilStopped?: boolean }): () => void;
}

export interface Binding<TActor extends AnyActorRef = AnyActorRef> extends ViewSource {
  /** Stands in for the real actor everywhere consumers can reach it; one per real actor. */
  readonly proxy: TActor;
  /** The registration for an identity; the same object while the identity stays the same. */
  registration(identity: Identity): Registration;
  /** Calls the listener when what the proxy shows changes because of a preview, rather than the real actor. */
  onPreviewChange(listener: () => void): () => void;
  /**
   * Ends the proxy.subscribe()s of the actor, as unsubscribing does. @xstate/react drops the actor's XState observers
   * without telling them when it stops a hook's actor, and those subscriptions would otherwise keep following previews.
   * One still owed how the actor ended, which a preview held back, stays until the preview ends and it hears it.
   */
  dropObservers(): void;
}

// A function rather than a constant, so production builds can remove it.
const observableKey = (): PropertyKey => (Symbol as { observable?: symbol }).observable ?? '@@observable';
const noop = (): void => {};

// One binding per real actor, so re-renders, StrictMode's second render and label changes all hand out the same
// proxy. Creating one has no side effects; Registration.connect() has them.
const bindings = new WeakMap<AnyActorRef, Binding>();
const proxies = new WeakSet<object>();

/** True for proxies made by the adapter, so they aren't wrapped twice. */
export function isProxy(value: unknown): boolean {
  return typeof value === 'object' && value !== null && proxies.has(value);
}

/** The actor's binding, if a hook or connect() made one. */
export function findBinding<TActor extends AnyActorRef>(actor: TActor): Binding<TActor> | undefined {
  return bindings.get(actor) as Binding<TActor> | undefined;
}

export function getBinding<TActor extends AnyActorRef>(actor: TActor): Binding<TActor> {
  let binding = bindings.get(actor);
  if (!binding) {
    binding = createBinding(actor as unknown as MachineActor);
    bindings.set(actor, binding);
  }
  return binding as unknown as Binding<TActor>;
}

function createBinding(actor: MachineActor): Binding {
  const registry = getRegistry();
  const machine = actor.logic;
  // The instance key the proxy reads previews from. Set by the first registration, so an actor that HMR recreated
  // shows the preview on its first render, and moved by connect() when the id changes.
  let key: string | undefined;
  let latest: { identity: Identity; registration: Registration } | undefined;
  const previewListeners = new Set<() => void>();
  let stopWatching: (() => void) | undefined;
  // Made on first use, as are `views` and `bound` below: most actors never need them, and each mount makes a binding.
  let stopListeners: Set<() => void> | undefined;
  // Connected registrations. The registry is watched only while one is, or while it still keeps a preview for the key,
  // which it releases at its next flush after the last one disconnects. Nothing previews an actor nobody registers,
  // and the page-wide registry would otherwise keep it alive through subscribers that never unsubscribe: XState lets
  // them on a finished actor, and a waitFor can start after the component unmounted.
  let connections = 0;
  let emitting = 0;

  function currentOverride(): Override | undefined {
    return key === undefined ? undefined : registry.getOverride(key);
  }

  function emitPreviewChange(): void {
    emitting++;
    try {
      for (const listener of [...previewListeners]) {
        if (previewListeners.has(listener)) callListener(listener, `A subscriber of "${key}" threw.`);
      }
    } finally {
      emitting--;
    }
    // After the delivery, so every subscriber hears the release that ends the last preview.
    unwatchIfIdle();
  }

  function shouldWatch(): boolean {
    return key !== undefined && previewListeners.size > 0 && (connections > 0 || currentOverride() !== undefined);
  }

  // One registry listener for all of the proxy's subscribers, moved along when the key changes.
  function watch(): void {
    stopWatching?.();
    stopWatching = shouldWatch() ? registry.onOverride(key!, emitPreviewChange) : undefined;
  }

  function unwatchIfIdle(): void {
    if (emitting > 0 || !stopWatching || shouldWatch()) return;
    stopWatching();
    stopWatching = undefined;
  }

  function onPreviewChange(listener: () => void): () => void {
    // A wrapper per call, so subscribing the same function twice gives two independent subscriptions.
    const entry = (): void => listener();
    previewListeners.add(entry);
    if (!stopWatching) watch();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      previewListeners.delete(entry);
      unwatchIfIdle();
    };
  }

  function setKey(next: string): void {
    if (key === next) return;
    key = next;
    watch();
    emitPreviewChange();
  }

  // The forced snapshot for the current override, kept until the override or the carried-over children change,
  // so getSnapshot() returns the same object for useSyncExternalStore.
  let forced:
    | { override: Override; base: AnyMachineSnapshot | undefined; children: object; snapshot: AnyMachineSnapshot | undefined }
    | undefined;

  function forcedSnapshot(override: Override, live: unknown): AnyMachineSnapshot | undefined {
    if (forced?.override !== override) {
      let base: AnyMachineSnapshot | undefined;
      try {
        base = resolveSnapshot(machine, override.leaves, override.context, actor);
      } catch (error) {
        // An override made for another handle under this key, such as the actor HMR replaced, can name states this
        // machine doesn't have, or no longer has side by side. The real snapshot shows until the registry releases it.
        console.warn(`[state-viewer] Can't show the preview of "${key}" on this actor; showing its real state.`, error);
      }
      forced = { override, base, children: EMPTY_CHILDREN, snapshot: base };
    }
    if (!forced.base) return undefined;
    // Children don't survive resolveState, so the live ones are carried over for components reading them.
    const children = liveChildren(live);
    if (!sameChildren(forced.children, children)) {
      forced.children = children;
      forced.snapshot = Object.keys(children).length === 0 ? forced.base : { ...forced.base, children };
    }
    return forced.snapshot;
  }

  // Above zero while an observer hears how the real actor ended, which it reads from the real snapshot.
  let showingLiveDepth = 0;

  function showingLive(fn: () => void): void {
    showingLiveDepth++;
    try {
      fn();
    } finally {
      showingLiveDepth--;
    }
  }

  function getSnapshot(): unknown {
    const live = actor.getSnapshot();
    const override = showingLiveDepth > 0 ? undefined : currentOverride();
    return (override && forcedSnapshot(override, live)) ?? live;
  }

  const source: ViewSource = {
    getSnapshot,
    getLiveSnapshot: () => actor.getSnapshot(),
    isPreviewing: () => currentOverride() !== undefined,
    showingLive,
  };

  // The proxy.subscribe() views still open, for dropObservers().
  let views: Set<View> | undefined;

  function subscribe(
    nextOrObserver?: Observer<unknown> | ((snapshot: unknown) => void),
    error?: (error: unknown) => void,
    complete?: () => void,
  ) {
    const target = toObserver(nextOrObserver, error, complete);
    let stopPreview = noop;
    const view = createView(target, () => source, 'notified', () => {
      views!.delete(view);
      stopPreview();
    });
    (views ??= new Set()).add(view);
    const subscription = actor.subscribe(view.observer);
    // An observer without next, such as toPromise's, has nothing to show, and listening would only keep it alive.
    if (target.next && !view.isClosed()) stopPreview = onPreviewChange(view.showCurrent);
    return {
      unsubscribe() {
        subscription.unsubscribe();
        // Also when it's called from the observer itself, so a held-back complete doesn't follow.
        view.close();
      },
    };
  }

  /** Logs and drops an event sent during a preview. Returns false when there's no preview. */
  function blocked(event: unknown): boolean {
    const override = currentOverride();
    if (!override) return false;
    if (!isEventObject(event)) {
      console.warn(`[state-viewer] Dropped an event without a string type sent to "${key}" during a preview.`, event);
      return true;
    }
    registry.logEvent({ instanceKey: override.instanceKey, event, leaves: override.leaves, blocked: true, at: Date.now() });
    return true;
  }

  // Actor.select, reading through the proxy so the selection follows the preview.
  function select<T>(selector: (snapshot: unknown) => T, equalityFn: (a: T, b: T) => boolean = Object.is) {
    return {
      subscribe(observerOrFn: Observer<T> | ((value: T) => void)) {
        const observer = toObserver(observerOrFn);
        let previous = selector(getSnapshot());
        return subscribe((snapshot) => {
          const next = selector(snapshot);
          if (!equalityFn(previous, next)) {
            previous = next;
            observer.next?.(next);
          }
        });
      },
      get: () => selector(getSnapshot()),
    };
  }

  let proxy: AnyActorRef;
  const members: Record<PropertyKey, unknown> = {
    getSnapshot,
    subscribe,
    // XState rejects string events itself, before anything is delivered.
    send: (event: unknown) => {
      if (typeof event === 'string' || !blocked(event)) actor.send(event as never);
    },
    // What sendTo, forwardTo and delayed sends call on their target, so an actor handed the proxy is blocked too.
    _send: (event: unknown) => {
      if (!blocked(event)) actor._send(event);
    },
    select,
    // These return the actor itself, which has to stay the proxy: `connect(createActor(m)).start()`.
    start: () => {
      actor.start();
      return proxy;
    },
    stop: () => {
      actor.stop();
      // An actor stopped before it started sends nothing XState can observe, so connect() hears about it here.
      if (stopListeners) for (const listener of [...stopListeners]) callListener(listener, `Stopping "${key}" threw.`);
      return proxy;
    },
    [observableKey()]: () => proxy,
  };
  // Bound once per method, so `proxy.on === proxy.on` and React dependency arrays stay stable.
  let bound: Map<PropertyKey, { source: (...args: unknown[]) => unknown; bound: unknown }> | undefined;

  proxy = new Proxy(actor, {
    get(target, property) {
      if (Object.hasOwn(members, property)) return members[property];
      if (property === 'ref') return proxy;
      const value: unknown = Reflect.get(target, property, target);
      // Everything else is the real actor's, bound to it. Constructors stay as they are for instanceof checks.
      if (typeof value !== 'function' || property === 'constructor') return value;
      bound ??= new Map();
      let entry = bound.get(property);
      if (entry?.source !== value) {
        entry = { source: value as (...args: unknown[]) => unknown, bound: value.bind(target) };
        bound.set(property, entry);
      }
      return entry.bound;
    },
  });
  proxies.add(proxy);

  function createRegistration(identity: Identity, registrationKey: string): Registration {
    const { handle, notify, record } = createHandle(actor, machine, identity, undefined, true, registry);
    return {
      key: registrationKey,
      handle,
      connect({ untilStopped = false } = {}) {
        if (isFallbackId(machine, identity.machineId)) warnFallbackId(identity.machineId);
        connections++;
        setKey(registrationKey);
        // Before registering, so a preview applied on registration (a deep link) reaches the subscribers.
        if (!stopWatching) watch();
        const unregister = registry.register(handle);
        record(actor.getSnapshot());
        let connected = true;
        let stopInspecting = noop;
        const disconnect = (): void => {
          if (!connected) return;
          connected = false;
          stopListeners?.delete(disconnect);
          stopInspecting();
          unregister();
          connections--;
          unwatchIfIdle();
        };
        // Inspection rather than actor.subscribe(): an observer without an error callback makes XState report errors
        // the app handles as unhandled, and one with an error callback hides errors the app doesn't handle.
        stopInspecting = inspect(actor, registrationKey, registry, (snapshot) => {
          record(snapshot);
          notify();
          if (untilStopped && statusOf(snapshot) !== 'active') disconnect();
        });
        if (untilStopped) (stopListeners ??= new Set()).add(disconnect);
        return disconnect;
      },
    };
  }

  return {
    ...source,
    proxy,
    registration(identity) {
      // Field by field, so a render that keeps the identity makes no strings. No label is the same as an empty one.
      const previous = latest?.identity;
      if (
        previous?.machineId === identity.machineId &&
        previous.instanceId === identity.instanceId &&
        (previous.label ?? '') === (identity.label ?? '')
      ) {
        return latest!.registration;
      }
      const registrationKey = toInstanceKey(identity.machineId, identity.instanceId);
      key ??= registrationKey;
      const registration = createRegistration(identity, registrationKey);
      latest = { identity, registration };
      return registration;
    },
    onPreviewChange,
    dropObservers() {
      if (views) for (const view of [...views]) view.drop();
    },
  };
}

function sameChildren(a: object, b: object): boolean {
  if (a === b) return true;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every(
    (key) => Object.hasOwn(b, key) && (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key],
  );
}

function isEventObject(event: unknown): event is { type: string; [key: string]: unknown } {
  return typeof event === 'object' && event !== null && typeof (event as { type?: unknown }).type === 'string';
}
