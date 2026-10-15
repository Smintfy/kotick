// Machine ids in the registry.

import type { AnyStateMachine } from 'xstate';
import type { AnyStateNode } from './tree';

/** The id XState gives a machine created without one. */
export const DEFAULT_MACHINE_ID = '(machine)';

const fallbackIds = new WeakMap<AnyStateMachine, string>();
const warned = new Set<string>();

/** `debug.id`, then `machine.id`, then a generated id for machines still on XState's default. */
export function resolveMachineId(machine: AnyStateMachine, debugId?: string): string {
  if (typeof debugId === 'string' && debugId !== '') return debugId;
  if (typeof machine.id === 'string' && machine.id !== '' && machine.id !== DEFAULT_MACHINE_ID) return machine.id;
  return fallbackMachineId(machine);
}

/** True when `machineId` is the id generated for this machine, which deserves a warning. */
export function isFallbackId(machine: AnyStateMachine, machineId: string): boolean {
  return fallbackIds.get(machine) === machineId;
}

/**
 * An id derived from the shape of the machine: its state tree and the keys of its initial context. HMR recreates the
 * machine object, and fixtures follow the registry id once it changes, so the id has to come out the same for
 * the recreated machine: it changes only when states are added, removed, renamed or change type, or context keys
 * come and go, not when states or keys are reordered. The context keys tell apart machines with the same states, such as two fetch machines, which would
 * otherwise share recordings and fixtures.
 */
export function fallbackMachineId(machine: AnyStateMachine): string {
  let id = fallbackIds.get(machine);
  if (id === undefined) {
    id = `machine-${hash(`${signature(machine.root)}|${contextKeys(machine)}`)}`;
    fallbackIds.set(machine, id);
  }
  return id;
}

/** Warns once per generated id, so a machine recreated by HMR doesn't warn again. */
export function warnFallbackId(id: string): void {
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(
    `[state-viewer] A machine has no id, so it's listed as "${id}". ` +
      `Give it one with createMachine({ id }) or with the debug option: { debug: { id } }.`,
  );
}

/** Children sorted by key, as context keys are: moving a state up or down doesn't change the machine. */
function signature(node: AnyStateNode): string {
  const children = (Object.values(node.states ?? {}) as AnyStateNode[]).sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  if (children.length === 0) return node.type;
  return `${node.type}{${children.map((child) => `${JSON.stringify(child.key)}:${signature(child)}`).join(',')}}`;
}

/** Sorted keys of a context given as an object; a context factory contributes nothing. */
function contextKeys(machine: AnyStateMachine): string {
  const context: unknown = (machine.config as { context?: unknown } | undefined)?.context;
  if (typeof context !== 'object' || context === null || Array.isArray(context)) return '';
  return JSON.stringify(Object.keys(context).sort());
}

/** FNV-1a, 32 bits, as 7 base-36 digits. Only needs to tell apart the anonymous machines on one page. */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(36).padStart(7, '0');
}
