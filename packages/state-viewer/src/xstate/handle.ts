// The machine handle: what the registry sees of an actor and of the child machines it starts.

import type { AnyActorRef, AnyMachineSnapshot, AnyStateMachine } from 'xstate';
import { callListener, toInstanceKey } from '../core/registry';
import type { Capabilities, MachineHandle, Registry, StateNodeInfo } from '../core/types';
import { isMachineActor, liveChildren, statusOf, type MachineActor } from './actor';
import { isFallbackId, resolveMachineId, warnFallbackId, type Identity } from './identity';
import { normalizeLeaves } from './preview-snapshot';
import { getTree, leavesOfSnapshot } from './tree';

const PREVIEW_CAPABILITIES: Capabilities = /* @__PURE__ */ Object.freeze({
  preview: true,
  live: false,
  children: true,
});
const READ_ONLY_CAPABILITIES: Capabilities = /* @__PURE__ */ Object.freeze({
  preview: false,
  live: false,
  children: true,
});

interface ObservedHandle {
  handle: MachineHandle;
  notify(): void;
  /** Hot path: keeps a reference to the context; serialization happens later. */
  record(snapshot: unknown): void;
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
  // Made on the first subscribe(). Only the open panel subscribes, and only to the handle it shows.
  let listeners: Set<() => void> | undefined;
  // The leaves of the snapshot recorded last. An actor records the same snapshot when it connects and when it starts.
  let recordedSnapshot: unknown;
  let recordedLeaves: string[] = [];

  const handle: MachineHandle = {
    machineId: identity.machineId,
    instanceId: identity.instanceId,
    adapter: 'xstate',
    capabilities: preview ? PREVIEW_CAPABILITIES : READ_ONLY_CAPABILITIES,
    // The config, not the machine: machine.provide() makes a new machine around the same config, and fixtures
    // defined for the machine should still match.
    source: machine.config,
    describe: () => getTree(machine).nodes as StateNodeInfo[],
    getActiveLeaves: () => leavesOfSnapshot(machine, actor.getSnapshot()),
    getContext: () => contextOf(actor.getSnapshot()),
    subscribe(onChange) {
      const listener = (): void => onChange();
      (listeners ??= new Set()).add(listener);
      return () => {
        listeners!.delete(listener);
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
      if (!listeners || listeners.size === 0) return;
      for (const listener of [...listeners]) {
        if (listeners.has(listener)) callListener(listener, `A listener of "${key}" threw.`);
      }
    },
    record(snapshot) {
      const status = statusOf(snapshot);
      if (status !== 'active' && status !== 'done') return;
      if (snapshot !== recordedSnapshot) {
        recordedSnapshot = snapshot;
        recordedLeaves = leavesOfSnapshot(machine, snapshot);
      }
      if (recordedLeaves.length > 0) registry.record(key, recordedLeaves, (snapshot as AnyMachineSnapshot).context);
    },
  };
}

// Handles of child machines, per child actor and parent key, so StrictMode's reconnect registers the same objects.
const childHandles = new WeakMap<AnyActorRef, ObservedHandle>();

/**
 * Watches an actor's system: snapshots of the actor itself go to `onRootSnapshot`, and its child machines
 * are listed read-only under it. The system takes an inspector after creation, which covers hooks and connect()
 * alike; children that already exist are found through the snapshot.
 */
export function inspect(
  root: MachineActor,
  rootKey: string,
  registry: Registry,
  onRootSnapshot: (snapshot: unknown) => void,
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
    if (statusOf(ref.getSnapshot()) !== 'active') return;
    let child = childHandles.get(ref);
    if (child?.handle.parentKey !== parentKey) {
      const machineId = resolveMachineId(ref.logic);
      if (isFallbackId(ref.logic, machineId)) warnFallbackId(machineId);
      // An invoke or spawn id names the child better than its session id.
      const label = typeof ref.id === 'string' && ref.id !== ref.sessionId ? ref.id : undefined;
      child = createHandle(ref, ref.logic, { machineId, instanceId: ref.sessionId, label }, parentKey, false, registry);
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
          if (!connected || connected.size === 0) return;
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
        const entry = connected?.get(ref);
        if (!entry) {
          add(ref);
          return;
        }
        entry.child.record(event.snapshot);
        entry.child.notify();
      } else if (event.type === '@xstate.event' && event.sourceRef) {
        // A child that fails sends its parent an error event, and no last snapshot.
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
    if (!connected) return;
    // A connect()ed actor that finishes along with its child disconnects before the child's done snapshot comes in.
    for (const [ref, { child, unregister }] of connected) {
      child.record(ref.getSnapshot());
      unregister();
    }
    connected.clear();
  };
}

function contextOf(snapshot: unknown): unknown {
  return typeof snapshot === 'object' && snapshot !== null ? (snapshot as { context?: unknown }).context : undefined;
}
