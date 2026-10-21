import { isMachineSnapshot, type AnyActorRef, type AnyEventObject, type AnyStateMachine, type Snapshot } from 'xstate';
import { callLoggingErrors, toInstanceKey } from '../core/registry';
import type { Capabilities, MachineHandle, Registry } from '../types';
import { isMachineActor, liveChildren, type MachineActor } from './actor';
import { isFallbackId, resolveMachineId, warnFallbackId, type Identity } from './identity';
import { completeTarget } from './preview-snapshot';
import { getTree, leavesOfSnapshot } from './tree';

const PREVIEW_CAPABILITIES: Capabilities = /* @__PURE__ */ Object.freeze({
  preview: true,
});

const READ_ONLY_CAPABILITIES: Capabilities = /* @__PURE__ */ Object.freeze({
  preview: false,
});

interface ObservedHandle {
  handle: MachineHandle;
  notify(): void;
  record(snapshot: Snapshot<unknown>): void;
}

export function createHandle(
  actor: MachineActor,
  machine: AnyStateMachine,
  identity: Identity,
  parentKey: string | undefined,
  preview: boolean,
  registry: Registry,
): ObservedHandle {
  const key = toInstanceKey(identity.machineId, identity.instanceId);
  // Only the open panel subscribes, and only to the handle it shows.
  let listeners: Set<() => void> | undefined;
  // An actor records the same snapshot when it connects and when it starts.
  let recordedSnapshot: Snapshot<unknown> | undefined;
  let recordedLeaves: string[] = [];

  const handle: MachineHandle = {
    machineId: identity.machineId,
    instanceId: identity.instanceId,
    capabilities: preview ? PREVIEW_CAPABILITIES : READ_ONLY_CAPABILITIES,
    definitionId: resolveMachineId(machine),
    describe: () => getTree(machine).nodes,
    getActiveLeaves: () => leavesOfSnapshot(machine, actor.getSnapshot()),
    getContext: () => contextOf(actor.getSnapshot()),
    subscribe(onChange) {
      const listener = (): void => onChange();
      (listeners ??= new Set()).add(listener);

      return () => {
        listeners!.delete(listener);
      };
    },
    normalizeTarget: (leaves) => completeTarget(machine, leaves, leavesOfSnapshot(machine, actor.getSnapshot())),
  };

  if (identity.label !== undefined) handle.label = identity.label;

  if (parentKey !== undefined) handle.parentKey = parentKey;
  Object.freeze(handle);

  return {
    handle,
    notify() {
      if (!listeners || listeners.size === 0) return;

      for (const listener of Array.from(listeners)) {
        if (listeners.has(listener)) callLoggingErrors(listener, `A listener of "${key}" threw.`);
      }
    },
    record(snapshot) {
      if (snapshot.status !== 'active' && snapshot.status !== 'done') return;

      if (snapshot !== recordedSnapshot) {
        recordedSnapshot = snapshot;
        recordedLeaves = leavesOfSnapshot(machine, snapshot);
      }

      if (recordedLeaves.length > 0) registry.record(key, recordedLeaves, contextOf(snapshot));
    },
  };
}

// Handles of child machines, per child actor and parent key, so StrictMode's reconnect registers the same objects.
const childHandles = new WeakMap<AnyActorRef, ObservedHandle>();

/**
 * The system takes an inspector after creation, which covers hooks and connect() alike.
 * The inspector doesn't report earlier events, so children that already exist are found through the snapshot.
 */
export function inspect(
  root: MachineActor,
  rootKey: string,
  registry: Registry,
  onRootSnapshot: (snapshot: Snapshot<unknown>) => void,
): () => void {
  // Made when the first child comes in: most machines have no child machines.
  let connected: Map<AnyActorRef, { child: ObservedHandle; unregister: () => void }> | undefined;

  function keyOf(ref: AnyActorRef): string | undefined {
    if (ref === root) return rootKey;
    const handle = connected?.get(ref)?.child.handle;

    return handle && toInstanceKey(handle.machineId, handle.instanceId);
  }

  function add(ref: AnyActorRef): void {
    if (connected?.has(ref) || !isMachineActor(ref)) return;
    // The system reports all its actors, including the ancestors and siblings of an actor connect()ed below its root.
    // XState also leaves the children of a failed actor running.
    const parentKey = ref._parent && keyOf(ref._parent);

    if (parentKey === undefined) return;

    if (ref.getSnapshot().status !== 'active') return;
    let child = childHandles.get(ref);

    if (child?.handle.parentKey !== parentKey) {
      const machineId = resolveMachineId(ref.logic);

      if (isFallbackId(ref.logic, machineId)) warnFallbackId(machineId);
      const identity = { machineId, instanceId: ref.sessionId, label: childLabel(ref) };
      child = createHandle(ref, ref.logic, identity, parentKey, false, registry);
      childHandles.set(ref, child);
    }

    (connected ??= new Map()).set(ref, { child, unregister: registry.register(child.handle) });
    child.record(ref.getSnapshot());
    // XState starts children before their parent's first snapshot, so the ones turned away above come in now.
    walk(ref);
  }

  function remove(ref: AnyActorRef): void {
    const entry = connected?.get(ref);

    if (!connected || !entry) return;
    // A final configuration can still be unseen here.
    // For example, a grandchild that finishes can end its parent before the grandchild's own snapshot comes in.
    entry.child.record(ref.getSnapshot());
    connected.delete(ref);
    entry.unregister();

    // XState leaves the children of a failed actor running, out of reach of the tree.
    for (const other of Array.from(connected.keys())) {
      if (other._parent === ref) remove(other);
    }
  }

  function walk(ref: AnyActorRef): void {
    for (const child of Object.values(liveChildren(ref.getSnapshot()))) add(child);
  }

  /** A backstop for children that ended without telling anyone, or before their own snapshot came in. */
  function removeEndedChildren(): void {
    if (!connected) return;

    for (const child of Array.from(connected.keys())) {
      if (child.getSnapshot().status !== 'active') remove(child);
    }
  }

  walk(root);

  const subscription = root.system.inspect({
    next(event) {
      if (event.type === '@xstate.snapshot') {
        // SAFETY: The system reports its own actors, which have every member of an actor ref. XState's event types
        // name only the members an inspector needs.
        const ref = event.actorRef as AnyActorRef;

        if (ref === root) {
          onRootSnapshot(event.snapshot);
          removeEndedChildren();

          return;
        }

        if (event.snapshot.status !== 'active') {
          remove(ref);

          return;
        }

        const entry = connected?.get(ref);

        if (!entry) {
          add(ref);

          return;
        }

        entry.child.record(event.snapshot);
        entry.child.notify();
      } else if (event.type === '@xstate.event' && event.sourceRef) {
        // SAFETY: As for the snapshot event's ref above: the source is one of the system's own actors.
        const source = event.sourceRef as AnyActorRef;

        // A child that fails sends its parent an error event, and no last snapshot.
        if (isActorErrorEvent(event.event)) remove(source);
      }
    },
  });

  let active = true;

  return () => {
    if (!active) return;
    active = false;
    subscription.unsubscribe();

    if (!connected) return;

    // A connect()ed actor that finishes along with its child disconnects before the child's done snapshot comes in.
    for (const [ref, { child, unregister }] of connected) {
      child.record(ref.getSnapshot());
      unregister();
    }

    connected.clear();
  };
}

/** XState relays an event from one actor to another without a check, so an app can send one with no string type. */
function isActorErrorEvent(event: AnyEventObject | undefined): event is AnyEventObject {
  return typeof event?.type === 'string' && event.type.startsWith('xstate.error.actor');
}

/** An invoke or spawn id names the child better than its session id. */
function childLabel(ref: AnyActorRef): string | undefined {
  return isChildId(ref.id) && ref.id !== ref.sessionId ? ref.id : undefined;
}

/** A JavaScript app can give any value, such as a number. */
function isChildId(id: AnyActorRef['id']): id is string {
  return typeof id === 'string';
}

// oxlint-disable-next-line anti-slop/no-unknown-returns -- A context is the app's own data, and it has no schema.
function contextOf(snapshot: Snapshot<unknown>): unknown {
  return isMachineSnapshot(snapshot) ? snapshot.context : undefined;
}
