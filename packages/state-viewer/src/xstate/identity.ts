// What names an actor in the registry: its machine id, its instance id, and an optional label.

import type { AnyStateMachine, MachineContext } from 'xstate';
import { childNodes, type AnyStateNode } from './tree';

export interface Identity {
  machineId: string;
  instanceId: string;
  label?: string;
}

/** The id XState gives a machine created without one. */
const DEFAULT_MACHINE_ID = '(machine)';

const COUNTER_KEY = '__STATE_VIEWER_LAST_INSTANCE__';
const fallbackIds = new WeakMap<AnyStateMachine, string>();
const warned = new Set<string>();

/** `debug.id`, then `machine.id`, then a generated id for machines still on XState's default. */
export function resolveMachineId(machine: AnyStateMachine, debugId?: string): string {
  if (debugId !== undefined && debugId !== '') return debugId;

  if (machine.id !== '' && machine.id !== DEFAULT_MACHINE_ID) return machine.id;

  return fallbackMachineId(machine);
}

export function isFallbackId(machine: AnyStateMachine, machineId: string): boolean {
  return fallbackIds.get(machine) === machineId;
}

/**
 * An id derived from the machine's state tree and the keys of its initial context.
 * HMR recreates the machine object, and fixtures follow the registry id once it changes.
 * So the id must come out the same for the recreated machine.
 * It changes when states are added, removed, renamed or change type, or when context keys come and go.
 * It doesn't change when states or keys are reordered.
 * The context keys tell apart machines with the same states, such as two fetch machines.
 * Without them, those machines would share recordings and fixtures.
 */
function fallbackMachineId(machine: AnyStateMachine): string {
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

/**
 * A page-unique instance id.
 * The counter lives on globalThis, so every React root and every copy of the package draw from one sequence.
 * React's useId isn't enough, because separately hydrated roots each start from the same tree-position ids.
 * So two islands that render one machine would share a key.
 */
export function nextInstanceId(): string {
  // SAFETY: The counter is a property this package adds to globalThis, under a key that nothing else uses.
  const scope = globalThis as typeof globalThis & { [COUNTER_KEY]?: number };
  const next = (scope[COUNTER_KEY] ?? 0) + 1;
  scope[COUNTER_KEY] = next;

  return String(next);
}

/** Children sorted by key, as context keys are: moving a state up or down doesn't change the machine. */
function signature(node: AnyStateNode): string {
  const children = childNodes(node).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  if (children.length === 0) return node.type;

  return `${node.type}{${children.map((child) => `${JSON.stringify(child.key)}:${signature(child)}`).join(',')}}`;
}

/** A context written as an object. A context factory makes one when the actor starts. */
function isContextObject(context: unknown): context is MachineContext {
  return typeof context === 'object' && context !== null && !Array.isArray(context);
}

/** Sorted keys of a context given as an object; a context factory contributes nothing. */
function contextKeys(machine: AnyStateMachine): string {
  const { context } = machine.config;

  return isContextObject(context) ? JSON.stringify(Object.keys(context).sort()) : '';
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
