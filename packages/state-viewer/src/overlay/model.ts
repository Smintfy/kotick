// What the panel derives from the registry snapshot, as pure functions.
// It groups machines by id, labels instances, names the panel's pages, finds the leaves a click previews, and plans
// the targets of "Copy link".

import { toInstanceKey } from '../core/registry';
import type { DeepLinkTarget, MachineHandle, Override } from '../core/types';

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
      ordinal,
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

interface LinkPlan {
  targets: DeepLinkTarget[];
  /** Machine ids whose instances aren't all previewed the same way, which a machine-level link can't reproduce. */
  partial: string[];
}

interface LinkedInstance {
  key: string;
  override: Override | undefined;
}

/**
 * One target per previewed machine, with the requested leaves of the preview that linkedPreview() chooses.
 * After a reload, the regions that the preview didn't request follow the state of each instance.
 */
export function planLink(
  handles: readonly MachineHandle[],
  overrides: Readonly<Record<string, Override>>,
  selectedKey: string | undefined,
): LinkPlan {
  const byMachine = new Map<string, LinkedInstance[]>();
  for (const handle of handles) {
    // Child machines can't be previewed, and links skip them.
    if (!handle.capabilities?.preview) continue;
    const key = toInstanceKey(handle.machineId, handle.instanceId);
    let instances = byMachine.get(handle.machineId);
    if (!instances) {
      instances = [];
      byMachine.set(handle.machineId, instances);
    }
    instances.push({ key, override: overrides[key] });
  }

  const targets: DeepLinkTarget[] = [];
  const partial: string[] = [];
  for (const [machineId, instances] of byMachine) {
    const chosen = linkedPreview(instances, selectedKey);
    if (!chosen) continue;
    targets.push({ machineId, leaves: [...chosen.requested] });
    if (instances.some(({ override }) => !sameLeaves(override?.requested, chosen.requested))) partial.push(machineId);
  }
  return { targets, partial };
}

/** The preview of the selected instance, or else the preview of the first instance that registered. */
function linkedPreview(instances: readonly LinkedInstance[], selectedKey: string | undefined): Override | undefined {
  const selected = instances.find(({ key }) => key === selectedKey)?.override;
  return selected ?? instances.find(({ override }) => override !== undefined)?.override;
}

function sameLeaves(a: readonly string[] | undefined, b: readonly string[]): boolean {
  return a !== undefined && a.length === b.length && a.every((leaf, index) => leaf === b[index]);
}

/** What a handle method returns, or `fallback` when the adapter throws: the panel must keep rendering. */
export function attempt<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}
