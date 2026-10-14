// Actor proxy and machine handle (spec §7.1, §10.2): what consumers hold, and what the registry sees.

import { toObserver, type AnyActorRef, type AnyMachineSnapshot, type AnyStateMachine, type Observer } from 'xstate';
import { getRegistry, toInstanceKey } from '../core/registry';
import type { MachineHandle, Override, StateNodeInfo } from '../core/types';
import { isFallbackId, resolveMachineId, warnFallbackId } from './machine-id';
import { getTree, isMachine, leavesOfSnapshot, normalizeLeaves, resolveSnapshot } from './tree';
import { createView, type View, type ViewSource } from './view';

export interface Identity {
  machineId: string;
  instanceId: string;
  label?: string;
}

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

/** A machine actor as far as the adapter needs one. */
type MachineActor = AnyActorRef & {
  logic: AnyStateMachine;
  sessionId: string;
  _send(event: unknown): void;
};

// The /* @__PURE__ */ marks and the observableKey() function let production builds remove these (spec §10.7).
const EMPTY_CHILDREN: Readonly<Record<string, AnyActorRef>> = /* @__PURE__ */ Object.freeze({});
const observableKey = (): PropertyKey => (Symbol as { observable?: symbol }).observable ?? '@@observable';
const noop = (): void => {};

// One binding per real actor, so re-renders, StrictMode's second render and label changes all hand out the same
// proxy. Creating one has no side effects; Registration.connect() has them.
const bindings = new WeakMap<AnyActorRef, Binding>();
const proxies = new WeakSet<object>();

export function isMachineActor(actor: unknown): actor is MachineActor {
  return (
    typeof actor === 'object' &&
    actor !== null &&
    typeof (actor as AnyActorRef).getSnapshot === 'function' &&
    isMachine((actor as { logic?: unknown }).logic)
  );
}

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
  let latest: { identity: string; registration: Registration } | undefined;
  const previewListeners = new Set<() => void>();
  let stopWatching: (() => void) | undefined;
  const stopListeners = new Set<() => void>();
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
        if (previewListeners.has(listener)) call(listener, `A subscriber of "${key}" threw.`);
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

  // The forced snapshot for the current override (R11), kept until the override or the carried-over children change,
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
    // R15: children don't survive resolveState (§10.5), so the live ones are carried over for components reading them.
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
  const views = new Set<View>();

  function subscribe(
    nextOrObserver?: Observer<unknown> | ((snapshot: unknown) => void),
    error?: (error: unknown) => void,
    complete?: () => void,
  ) {
    const target = toObserver(nextOrObserver, error, complete);
    let stopPreview = noop;
    const view = createView(target, () => source, 'notified', () => {
      views.delete(view);
      stopPreview();
    });
    views.add(view);
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

  /** Logs and drops an event sent during a preview (R12). Returns false when there's no preview. */
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
      for (const listener of [...stopListeners]) call(listener, `Stopping "${key}" threw.`);
      return proxy;
    },
    [observableKey()]: () => proxy,
  };
  // Bound once per method, so `proxy.on === proxy.on` and React dependency arrays stay stable.
  const bound = new Map<PropertyKey, { source: (...args: unknown[]) => unknown; bound: unknown }>();

  proxy = new Proxy(actor, {
    get(target, property) {
      if (Object.hasOwn(members, property)) return members[property];
      if (property === 'ref') return proxy;
      const value: unknown = Reflect.get(target, property, target);
      // Everything else is the real actor's, bound to it (§7.1). Constructors stay as they are for instanceof checks.
      if (typeof value !== 'function' || property === 'constructor') return value;
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
    const { handle, notify, record } = createHandle(actor, machine, identity, undefined, true);
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
          stopListeners.delete(disconnect);
          stopInspecting();
          unregister();
          connections--;
          unwatchIfIdle();
        };
        // Inspection rather than actor.subscribe(): an observer without an error callback makes XState report errors
        // the app handles as unhandled, and one with an error callback hides errors the app doesn't handle.
        stopInspecting = inspect(actor, registrationKey, (snapshot) => {
          record(snapshot);
          notify();
          if (untilStopped && statusOf(snapshot) !== 'active') disconnect();
        });
        if (untilStopped) stopListeners.add(disconnect);
        return disconnect;
      },
    };
  }

  return {
    ...source,
    proxy,
    registration(identity) {
      const registrationKey = toInstanceKey(identity.machineId, identity.instanceId);
      const id = `${registrationKey}\n${identity.label ?? ''}`;
      if (latest?.identity === id) return latest.registration;
      key ??= registrationKey;
      const registration = createRegistration(identity, registrationKey);
      latest = { identity: id, registration };
      return registration;
    },
    onPreviewChange,
    dropObservers() {
      for (const view of [...views]) view.drop();
    },
  };
}

interface ObservedHandle {
  handle: MachineHandle;
  notify(): void;
  /** Hot path: keeps a reference to the context; serialization happens later (§10.3). */
  record(snapshot: unknown): void;
}

function createHandle(
  actor: MachineActor,
  machine: AnyStateMachine,
  identity: Identity,
  parentKey: string | undefined,
  preview: boolean,
): ObservedHandle {
  const registry = getRegistry();
  const key = toInstanceKey(identity.machineId, identity.instanceId);
  const listeners = new Set<() => void>();

  const handle: MachineHandle = {
    machineId: identity.machineId,
    instanceId: identity.instanceId,
    adapter: 'xstate',
    capabilities: Object.freeze({ preview, live: false, children: true }),
    // The config, not the machine: machine.provide() makes a new machine around the same config, and fixtures
    // defined for the machine should still match (D10).
    source: machine.config,
    describe: () => getTree(machine).nodes as StateNodeInfo[],
    getActiveLeaves: () => leavesOfSnapshot(machine, actor.getSnapshot()),
    getContext: () => contextOf(actor.getSnapshot()),
    subscribe(onChange) {
      const listener = (): void => onChange();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    normalizeTarget: (leaves) => normalizeLeaves(machine, leaves, leavesOfSnapshot(machine, actor.getSnapshot())),
  };
  if (identity.label !== undefined) handle.label = identity.label;
  if (parentKey !== undefined) handle.parentKey = parentKey;
  Object.freeze(handle);

  return {
    handle,
    notify() {
      for (const listener of [...listeners]) {
        if (listeners.has(listener)) call(listener, `A listener of "${key}" threw.`);
      }
    },
    record(snapshot) {
      const status = statusOf(snapshot);
      if (status !== 'active' && status !== 'done') return;
      const leaves = leavesOfSnapshot(machine, snapshot);
      if (leaves.length > 0) registry.record(key, leaves, (snapshot as AnyMachineSnapshot).context);
    },
  };
}

// Handles of child machines, per child actor and parent key, so StrictMode's reconnect registers the same objects.
const childHandles = new WeakMap<AnyActorRef, ObservedHandle>();

/**
 * Watches an actor's system: snapshots of the actor itself go to `onRootSnapshot`, and its child machines (R5, P1)
 * are listed read-only under it. The system takes an inspector after creation, which covers hooks and connect()
 * alike; children that already exist are found through the snapshot.
 */
function inspect(root: MachineActor, rootKey: string, onRootSnapshot: (snapshot: unknown) => void): () => void {
  const registry = getRegistry();
  const connected = new Map<AnyActorRef, { child: ObservedHandle; unregister: () => void }>();

  function keyOf(ref: AnyActorRef): string | undefined {
    if (ref === root) return rootKey;
    const handle = connected.get(ref)?.child.handle;
    return handle && toInstanceKey(handle.machineId, handle.instanceId);
  }

  function add(ref: AnyActorRef): void {
    if (connected.has(ref) || !isMachineActor(ref)) return;
    // Only under a listed parent. The system reports every actor in it, including the ancestors and siblings of an
    // actor connect()ed below its root, and XState leaves the children of a failed actor running.
    const parentKey = ref._parent && keyOf(ref._parent);
    if (parentKey === undefined) return;
    if (statusOf(ref.getSnapshot()) !== 'active') return;
    let child = childHandles.get(ref);
    if (child?.handle.parentKey !== parentKey) {
      const machineId = resolveMachineId(ref.logic);
      if (isFallbackId(ref.logic, machineId)) warnFallbackId(machineId);
      // An invoke or spawn id names the child better than its session id.
      const label = typeof ref.id === 'string' && ref.id !== ref.sessionId ? ref.id : undefined;
      child = createHandle(ref, ref.logic, { machineId, instanceId: ref.sessionId, label }, parentKey, false);
      childHandles.set(ref, child);
    }
    connected.set(ref, { child, unregister: registry.register(child.handle) });
    child.record(ref.getSnapshot());
    // XState starts children before their parent's first snapshot, so the ones turned away above come in now.
    walk(ref);
  }

  /**
   * Unlists a child and its descendants, recording each one's last snapshot first: a final configuration can still
   * be unseen, as when a grandchild's finish ends its parent before its own snapshot comes in (R17).
   */
  function remove(ref: AnyActorRef): void {
    const entry = connected.get(ref);
    if (!entry) return;
    entry.child.record(ref.getSnapshot());
    connected.delete(ref);
    entry.unregister();
    // XState leaves the children of a failed actor running, out of reach of the tree.
    for (const other of [...connected.keys()]) {
      if (other._parent === ref) remove(other);
    }
  }

  function walk(ref: AnyActorRef): void {
    for (const child of Object.values(liveChildren(ref.getSnapshot()))) add(child);
  }

  walk(root);
  const subscription = root.system.inspect({
    next(event) {
      if (event.type === '@xstate.snapshot') {
        const ref = event.actorRef as AnyActorRef;
        if (ref === root) {
          onRootSnapshot(event.snapshot);
          // A backstop for children that ended without telling anyone, or before their own snapshot came in.
          for (const child of [...connected.keys()]) {
            if (statusOf(child.getSnapshot()) !== 'active') remove(child);
          }
          return;
        }
        if (statusOf(event.snapshot) !== 'active') {
          remove(ref);
          return;
        }
        const entry = connected.get(ref);
        if (!entry) {
          add(ref);
          return;
        }
        entry.child.record(event.snapshot);
        entry.child.notify();
      } else if (event.type === '@xstate.event' && event.sourceRef) {
        // A child that fails sends its parent an error event, and no last snapshot.
        // The app can send anything, so the type isn't always a string.
        const type: unknown = event.event?.type;
        if (typeof type === 'string' && type.startsWith('xstate.error.actor')) remove(event.sourceRef as AnyActorRef);
      }
    },
  });

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    subscription.unsubscribe();
    // A connect()ed actor that finishes along with its child disconnects before the child's done snapshot comes in.
    for (const [ref, { child, unregister }] of connected) {
      child.record(ref.getSnapshot());
      unregister();
    }
    connected.clear();
  };
}

function statusOf(snapshot: unknown): unknown {
  return (snapshot as { status?: unknown } | null | undefined)?.status;
}

function contextOf(snapshot: unknown): unknown {
  return typeof snapshot === 'object' && snapshot !== null ? (snapshot as { context?: unknown }).context : undefined;
}

function liveChildren(snapshot: unknown): Readonly<Record<string, AnyActorRef>> {
  const children = (snapshot as { children?: unknown } | null | undefined)?.children;
  return typeof children === 'object' && children !== null ? (children as Record<string, AnyActorRef>) : EMPTY_CHILDREN;
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

function call(listener: () => void, message: string): void {
  try {
    listener();
  } catch (error) {
    console.error(`[state-viewer] ${message}`, error);
  }
}
