// What the panel derives from the registry snapshot, as pure functions.
// It groups machines by id, labels instances, names the panel's pages, and finds the leaves a click previews.

import { toInstanceKey } from '../core/registry';
import type { MachineHandle, StateNodeInfo } from '../types';

export interface InstanceEntry {
  key: string;
  handle: MachineHandle;
  /** `checkout · 1`, or the handle's label in place of the machine id. */
  label: string;
}

export interface MachineGroup {
  machineId: string;
  instances: InstanceEntry[];
  /** Child machines are listed read-only. */
  childrenOnly: boolean;
}

/** Groups handles by machine id, in the order each id first registered. */
export function groupMachines(handles: readonly MachineHandle[]): MachineGroup[] {
  const groups = new Map<string, MachineGroup>();

  for (const handle of handles) {
    let group = groups.get(handle.machineId);

    if (!group) {
      group = { machineId: handle.machineId, instances: [], childrenOnly: true };
      groups.set(handle.machineId, group);
    }

    const ordinal = group.instances.length + 1;
    group.instances.push({
      key: toInstanceKey(handle.machineId, handle.instanceId),
      handle,
      label: `${handle.label ?? handle.machineId} · ${ordinal}`,
    });

    if (handle.parentKey === undefined) group.childrenOnly = false;
  }

  return [...groups.values()];
}

/** The page that the panel shows. Overlay derives it on each render and never stores it. */
export type PanelPage =
  | { kind: 'machines' }
  | { kind: 'settings' }
  | { kind: 'machine'; group: MachineGroup; instance: InstanceEntry };

export function findInstance(groups: readonly MachineGroup[], key: string | undefined): InstanceEntry | undefined {
  if (key === undefined) return undefined;

  for (const group of groups) {
    const entry = group.instances.find((instance) => instance.key === key);

    if (entry) return entry;
  }

  return undefined;
}

/** What a click on a leaf does to the instance's preview. */
export type LeafToggle = { action: 'preview'; leaves: string[] } | { action: 'release' };

/**
 * A requested leaf is taken out again, and the preview is released when no leaf stays.
 * Any other leaf goes first, so the registry resolves its fixture first.
 * normalizeTarget then drops the requested leaves that can't be active with the new leaf.
 * Requested leaves in other parallel regions stay.
 */
export function toggleLeaf(requested: readonly string[] | undefined, leaf: string): LeafToggle {
  if (!requested) return { action: 'preview', leaves: [leaf] };

  if (!requested.includes(leaf)) return { action: 'preview', leaves: [leaf, ...requested] };
  const kept = requested.filter((other) => other !== leaf);

  return kept.length === 0 ? { action: 'release' } : { action: 'preview', leaves: kept };
}

/** The leaf ids in tree order, without the leaves inside a collapsed compound or parallel state. */
export function shownLeaves(
  nodes: readonly StateNodeInfo[],
  collapsed: ReadonlySet<string>,
  into: string[] = [],
): string[] {
  for (const node of nodes) {
    if (node.type === 'atomic' || node.type === 'final') into.push(node.id);
    else if (!collapsed.has(node.id)) shownLeaves(node.children ?? [], collapsed, into);
  }

  return into;
}

/** What a handle method returns, or `fallback` when the adapter throws: the panel must keep rendering. */
export function attempt<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}
