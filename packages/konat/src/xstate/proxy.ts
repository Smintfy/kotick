import {
  toObserver,
  type AnyActorRef,
  type AnyEventObject,
  type AnyMachineSnapshot,
  type Observer,
  type Snapshot,
} from 'xstate';
import { callLoggingErrors, getPageRegistry, toInstanceKey } from '../core/registry';
import type { EventLogEntry, MachineHandle, Override } from '../types';
import { EMPTY_CHILDREN, liveChildren, type ChildActors, type MachineActor } from './actor';
import { createHandle, inspect } from './handle';
import { isFallbackId, warnFallbackId, type Identity } from './identity';
import { resolveSnapshot } from './preview-snapshot';
import { createView, type View, type ViewSource } from './view';

export interface Registration {
  readonly key: string;
  readonly handle: MachineHandle;
  /** With `untilStopped`, the returned cleanup also runs once the actor is done, failed or stopped. */
  connect(options?: { untilStopped?: boolean }): () => void;
}

export interface Binding<TActor extends AnyActorRef = AnyActorRef> extends ViewSource {
  readonly proxy: TActor;
  /** The same object while the identity stays the same. */
  registration(identity: Identity): Registration;
  onPreviewChange(listener: () => void): () => void;
  /**
   * @xstate/react drops the actor's XState observers without telling them when it stops a hook's actor.
   * The proxy.subscribe()s would otherwise keep following previews.
   * A subscription that a preview kept from hearing how the actor ended stays until the preview ends and it hears it.
   */
  dropObservers(): void;
}

interface ForcedSnapshot {
  override: Override;
  base: AnyMachineSnapshot | undefined;
  children: ChildActors;
  snapshot: AnyMachineSnapshot | undefined;
}

type ActorMethod = (this: MachineActor, ...args: never[]) => void;

interface BoundMethod {
  source: ActorMethod;
  bound: ActorMethod;
}

// observableKey is a function, not a constant, so production builds can remove it.
const observableKey = (): PropertyKey => Symbol.observable ?? '@@observable';
const noop = (): void => {};

// One binding per real actor, so re-renders, StrictMode's second render and label changes all hand out the same
// proxy. Creating one has no side effects; Registration.connect() has them.
const bindings = new WeakMap<AnyActorRef, Binding>();
const proxies = new WeakSet<AnyActorRef>();

/** True for proxies made by the adapter, so they aren't wrapped twice. */
export function isProxy(actor: AnyActorRef): boolean {
  return proxies.has(actor);
}

export function findBinding<TActor extends AnyActorRef>(actor: TActor): Binding<TActor> | undefined {
  // SAFETY: The map holds each binding under its own actor, so the one found here has a proxy of `actor`.
  return bindings.get(actor) as Binding<TActor> | undefined;
}

export function getBinding<TActor extends MachineActor>(actor: TActor): Binding<TActor> {
  let binding = bindings.get(actor);

  if (!binding) {
    binding = createBinding(actor);
    bindings.set(actor, binding);
  }

  // SAFETY: The map holds each binding under its own actor, so this one has a proxy of `actor`.
  return binding as Binding<TActor>;
}

function createBinding(actor: MachineActor): Binding {
  const registry = getPageRegistry();
  const machine = actor.logic;
  // The instance key the proxy reads previews from. Set by the first registration, so an actor that HMR recreated
  // shows the preview on its first render, and moved by connect() when the id changes.
  let key: string | undefined;
  let latest: { identity: Identity; registration: Registration } | undefined;
  const previewListeners = new Set<() => void>();
  let stopWatching: (() => void) | undefined;
  // Made on first use, as are `views` and `bound` below: most actors never need them, and each mount makes a binding.
  let endListeners: Set<() => void> | undefined;
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
      for (const listener of Array.from(previewListeners)) {
        if (previewListeners.has(listener)) callLoggingErrors(listener, `A subscriber of "${key}" threw.`);
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

  // Kept until the override or the carried-over children change.
  // useSyncExternalStore needs getSnapshot() to return the same object until then.
  let forced: ForcedSnapshot | undefined;

  function forcedSnapshot(override: Override, live: Snapshot<unknown>): AnyMachineSnapshot | undefined {
    if (forced?.override !== override) {
      let base: AnyMachineSnapshot | undefined;

      try {
        base = resolveSnapshot(machine, override.leaves, override.context, actor);
      } catch (error) {
        // An override made for another handle under this key, such as the actor HMR replaced, can name states this
        // machine doesn't have, or no longer has side by side. The real snapshot shows until the registry releases it.
        console.warn(`[konat] Can't show the preview of "${key}" on this actor; showing its real state.`, error);
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

  function getSnapshot(): Snapshot<unknown> {
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

  let views: Set<View> | undefined;

  function subscribe(
    nextOrObserver?: Observer<Snapshot<unknown>> | ((snapshot: Snapshot<unknown>) => void),
    error?: Observer<Snapshot<unknown>>['error'],
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

  function blockIfPreviewing(event: AnyEventObject): boolean {
    const override = currentOverride();

    if (!override) return false;

    if (!isEventObject(event)) {
      console.warn(`[konat] Dropped an event without a string type sent to "${key}" during a preview.`, event);

      return true;
    }

    registry.logEvent({ instanceKey: override.instanceKey, event, leaves: override.leaves, at: Date.now() });

    return true;
  }

  // Actor.select, reading through the proxy so the selection follows the preview.
  function select<T>(selector: (snapshot: Snapshot<unknown>) => T, equalityFn: (a: T, b: T) => boolean = Object.is) {
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

  let proxy: MachineActor;

  const members = {
    getSnapshot,
    subscribe,
    // XState rejects string events itself, before anything is delivered.
    send: (event: AnyEventObject): void => {
      if (isStringEvent(event) || !blockIfPreviewing(event)) actor.send(event);
    },
    // XState's sendTo, forwardTo and delayed sends call this on their target.
    // So sends through the proxy are blocked too.
    _send: (event: AnyEventObject): void => {
      if (!blockIfPreviewing(event)) actor._send(event);
    },
    select,
    // These return the actor itself, which has to stay the proxy: `connect(createActor(m)).start()`.
    start: (): MachineActor => {
      actor.start();

      return proxy;
    },
    stop: (): MachineActor => {
      actor.stop();

      return proxy;
    },
  } satisfies Pick<MachineActor, 'getSnapshot' | 'subscribe' | 'send' | '_send' | 'start' | 'stop'> & {
    // XState 5.28 has no select() on an actor, so the type of the proxy's own select() is the contract.
    select: typeof select;
  };

  const isMember = (property: PropertyKey): property is keyof typeof members => Object.hasOwn(members, property);
  const observable = observableKey();
  const observe = (): MachineActor => proxy;

  // Bound once per method, so `proxy.on === proxy.on` and React dependency arrays stay stable.
  let bound: Map<PropertyKey, BoundMethod> | undefined;

  proxy = new Proxy(actor, {
    get(target, property) {
      if (isMember(property)) return members[property];

      if (property === 'ref') return proxy;

      if (property === observable) return observe;
      // SAFETY: The trap forwards every key a consumer reads. A key the actor's type doesn't declare, such as a private
      // field of XState's Actor, reads what the actor holds. The trap passes it on, or binds it when it is a function.
      const value: unknown = target[property as keyof MachineActor];

      // Unbound: a bound constructor isn't the class, and test snapshots print it as "bound Actor".
      if (!isActorMethod(value) || property === 'constructor') return value;
      bound ??= new Map();
      let entry = bound.get(property);

      if (entry?.source !== value) {
        entry = { source: value, bound: value.bind(target) };
        bound.set(property, entry);
      }

      return entry.bound;
    },
  });
  proxies.add(proxy);

  // When an actor stops before it starts, or fails, XState sends nothing that the adapter can observe.
  // So this wraps stop() and _error() on the real actor. The proxy's stop() calls the real stop() too.
  function onEnd(listener: () => void): void {
    if (!endListeners) {
      const listeners = (endListeners = new Set());

      const ended = (message: string): void => {
        for (const end of Array.from(listeners)) callLoggingErrors(end, message);
      };

      const { stop, _error } = actor;
      actor.stop = () => {
        stop.call(actor);
        ended(`Stopping "${key}" threw.`);

        return actor;
      };

      actor._error = (error) => {
        _error.call(actor, error);
        ended(`Unregistering "${key}", which failed, threw.`);
      };
    }

    endListeners.add(listener);
  }

  function createRegistration(identity: Identity, registrationKey: string): Registration {
    const { handle, notify, record } = createHandle(actor, machine, identity, undefined, true, registry);

    return {
      key: registrationKey,
      handle,
      connect({ untilStopped = false } = {}) {
        if (isFallbackId(machine, identity.machineId)) warnFallbackId(identity.machineId);
        connections++;
        setKey(registrationKey);

        if (!stopWatching) watch();
        const unregister = registry.register(handle);
        record(actor.getSnapshot());
        let connected = true;
        let stopInspecting = noop;

        const disconnect = (): void => {
          if (!connected) return;
          connected = false;
          endListeners?.delete(disconnect);
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

          if (untilStopped && snapshot.status !== 'active') disconnect();
        });

        if (untilStopped) onEnd(disconnect);

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
      if (views) for (const view of Array.from(views)) view.drop();
    },
  };
}

function sameChildren(a: ChildActors, b: ChildActors): boolean {
  if (a === b) return true;
  const keysA = Object.keys(a);

  if (keysA.length !== Object.keys(b).length) return false;

  return keysA.every((key) => Object.hasOwn(b, key) && a[key] === b[key]);
}

function isActorMethod(value: unknown): value is ActorMethod {
  return typeof value === 'function';
}

function isStringEvent(event: AnyEventObject | string): event is string {
  return typeof event === 'string';
}

/** A caller without types can send any value. The registry logs only events with a string type. */
function isEventObject(event: AnyEventObject): event is EventLogEntry['event'] {
  return typeof event === 'object' && event !== null && 'type' in event && typeof event.type === 'string';
}
