// What the panel derives from the registry snapshot: machines grouped by id, instance labels, the leaves a click
// previews and the targets "Copy link" writes. Pure, so it's tested without rendering.

import { toInstanceKey } from '../core/registry';
import type { DeepLinkTarget, MachineHandle, Override, StateNodeInfo } from '../core/types';

export interface InstanceEntry {
  key: string;
  handle: MachineHandle;
  /** Position among the machine's instances, from 1, in registration order. */
  ordinal: number;
  /** `checkout · 1`, or the handle's label in place of the machine id. */
  label: string;
}

export interface MachineGroup {
  machineId: string;
  instances: InstanceEntry[];
  /** Every instance is a child machine, listed read-only. */
  child: boolean;
}

/** Groups handles by machine id, in the order each id first registered. */
export function groupMachines(handles: readonly MachineHandle[]): MachineGroup[] {
  const groups = new Map<string, MachineGroup>();
  for (const handle of handles) {
    let group = groups.get(handle.machineId);
    if (!group) {
      group = { machineId: handle.machineId, instances: [], child: true };
      groups.set(handle.machineId, group);
    }
    const ordinal = group.instances.length + 1;
    group.instances.push({
      key: toInstanceKey(handle.machineId, handle.instanceId),
      handle,
      ordinal,
      label: `${handle.label ?? handle.machineId} · ${ordinal}`,
    });
    if (handle.parentKey === undefined) group.child = false;
  }
  return [...groups.values()];
}

export function findInstance(groups: readonly MachineGroup[], key: string | undefined): InstanceEntry | undefined {
  if (key === undefined) return undefined;
  for (const group of groups) {
    const entry = group.instances.find((instance) => instance.key === key);
    if (entry) return entry;
  }
  return undefined;
}

/**
 * The leaves to preview after selecting `leaf`, or an empty array to release. A requested leaf is taken out again;
 * any other goes first, so the registry resolves its fixture first and normalizeTarget drops the requested
 * leaves it can't be active with, while leaves in other parallel regions stay.
 */
export function toggleLeaf(requested: readonly string[] | undefined, leaf: string): string[] {
  if (!requested) return [leaf];
  if (requested.includes(leaf)) return requested.filter((other) => other !== leaf);
  return [leaf, ...requested];
}

/** Atomic and final states in document order, the ones a preview can select. */
export function leavesOf(nodes: readonly StateNodeInfo[], into: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === 'atomic' || node.type === 'final') into.push(node.id);
    leavesOf(node.children ?? [], into);
  }
  return into;
}

interface LinkPlan {
  targets: DeepLinkTarget[];
  /** Machine ids whose instances aren't all previewed the same way, which a machine-level link can't reproduce. */
  partial: string[];
}

/**
 * One target per previewed machine: the selected instance's preview if it has one, otherwise that of the
 * first-registered previewed instance. The override's requested leaves, so after a reload untouched regions follow
 * each instance's own state.
 */
export function planLink(
  handles: readonly MachineHandle[],
  overrides: Readonly<Record<string, Override>>,
  selectedKey: string | undefined,
): LinkPlan {
  const byMachine = new Map<string, { chosen?: Override; requested: (readonly string[] | undefined)[] }>();
  for (const handle of handles) {
    // Child machines can't be previewed, and links skip them.
    if (!handle.capabilities?.preview) continue;
    const key = toInstanceKey(handle.machineId, handle.instanceId);
    const override = overrides[key];
    let entry = byMachine.get(handle.machineId);
    if (!entry) {
      entry = { requested: [] };
      byMachine.set(handle.machineId, entry);
    }
    entry.requested.push(override?.requested);
    if (override && (!entry.chosen || key === selectedKey)) entry.chosen = override;
  }

  const targets: DeepLinkTarget[] = [];
  const partial: string[] = [];
  for (const [machineId, { chosen, requested }] of byMachine) {
    if (!chosen) continue;
    targets.push({ machineId, leaves: [...chosen.requested] });
    if (requested.some((leaves) => !sameLeaves(leaves, chosen.requested))) partial.push(machineId);
  }
  return { targets, partial };
}

function sameLeaves(a: readonly string[] | undefined, b: readonly string[]): boolean {
  return a !== undefined && a.length === b.length && a.every((leaf, index) => leaf === b[index]);
}
