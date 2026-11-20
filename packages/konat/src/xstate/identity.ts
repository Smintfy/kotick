import type { AnyStateMachine, MachineContext } from 'xstate';
import { isId } from '../core/ids';
import { warnOnce } from '../core/warn-once';
import { childNodes, type AnyStateNode } from './tree';

export interface Identity {
  machineId: string;
  instanceId: string;
  label?: string;
}

/** The id XState gives a machine created without one. */
const DEFAULT_MACHINE_ID = '(machine)';

const fallbackIds = new WeakMap<AnyStateMachine, string>();

export function resolveMachineId(machine: AnyStateMachine, debugId?: string): string {
  if (isId(debugId)) return debugId;

  // A JavaScript app can give a machine an id that is not a string.
  if (isId(machine.id) && machine.id !== DEFAULT_MACHINE_ID) return machine.id;

  return fallbackMachineId(machine);
}

export function isFallbackId(machine: AnyStateMachine, machineId: string): boolean {
  return fallbackIds.get(machine) === machineId;
}

/**
 * An id derived from the machine's state tree and the keys of its initial context.
 * HMR recreates the machine object, and recordings and fixtures find the machine by this id.
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

export function warnFallbackId(id: string): void {
  warnOnce(
    `fallback-id:${id}`,
    `[konat] A machine has no id, so it's listed as "${id}". ` +
      `Give it one with createMachine({ id }) or with the debug option: { debug: { id } }.`,
  );
}

/** Children are sorted by key, as context keys are, so moving a state up or down doesn't change the machine. */
function signature(node: AnyStateNode): string {
  const children = childNodes(node).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  if (children.length === 0) return node.type;

  return `${node.type}{${children.map((child) => `${JSON.stringify(child.key)}:${signature(child)}`).join(',')}}`;
}

function isContextObject(context: unknown): context is MachineContext {
  return typeof context === 'object' && context !== null && !Array.isArray(context);
}

/** A context factory contributes nothing. It makes the context only when the actor starts. */
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
