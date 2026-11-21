import { liveContextFits } from '../core/live-context';
import { toInstanceKey } from '../core/registry';
import type { DataAvailability, MachineHandle, StateNodeInfo } from '../types';

export interface InstanceEntry {
  key: string;
  handle: MachineHandle;
  label: string;
}

export interface MachineGroup {
  machineId: string;
  instances: InstanceEntry[];
  childrenOnly: boolean;
}

/** In the order that each machine id first registered. */
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

export type LeafToggle = { action: 'preview'; leaves: string[] } | { action: 'release' };

/**
 * A requested leaf is taken out again, and the preview is released when no leaf stays.
 * Another leaf goes first, so it wins over the requested leaves.
 */
export function toggleLeaf(requested: readonly string[] | undefined, leaf: string): LeafToggle {
  if (!requested) return { action: 'preview', leaves: [leaf] };

  if (!requested.includes(leaf)) return { action: 'preview', leaves: [leaf, ...requested] };
  const kept = requested.filter((other) => other !== leaf);

  return kept.length === 0 ? { action: 'release' } : { action: 'preview', leaves: kept };
}

/** In tree order, without the leaves inside a collapsed compound or parallel state. */
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

/**
 * Whether a preview of the leaf can get data: a recording, a fixture, or a live context that fits the leaf.
 * The registry refuses a preview of any other leaf, so the panel disables its row.
 */
export function canPreviewLeaf(
  handle: Pick<MachineHandle, 'capabilities' | 'getActiveLeaves'>,
  data: DataAvailability,
  leaf: string,
): boolean {
  return (
    data.recorded.has(leaf) || data.fixture.has(leaf) || liveContextFits(handle, { requested: [leaf], filled: [] })
  );
}

const NONE_COLLAPSED: ReadonlySet<string> = new Set();

/**
 * The warnings under States, from data that the panel has already, so the protocol gets no method for them.
 * Only a machine whose states share no context gets them, so an XState machine never shows one.
 */
export function panelWarnings(
  handle: Pick<MachineHandle, 'capabilities' | 'getActiveLeaves'>,
  nodes: readonly StateNodeInfo[],
  data: DataAvailability,
): string[] {
  if (handle.capabilities?.sharedContext !== false || nodes.length === 0) return [];
  const warnings: string[] = [];

  if (attempt(() => handle.getActiveLeaves(), []).length === 0) {
    warnings.push("The machine is in a state that its definition doesn't declare. The console names the state.");
  }

  const noData = shownLeaves(nodes, NONE_COLLAPSED).filter((leaf) => !canPreviewLeaf(handle, data, leaf));

  if (noData.length > 0) {
    warnings.push(`No data to preview ${noData.join(', ')}. Visit them in the app, or add them to defineFixtures().`);
  }

  return warnings;
}

/** The adapter can throw, and the panel must keep rendering. */
export function attempt<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}
