// The state tree of an XState machine, and the leaves that a state value names.

import type { AnyMachineSnapshot, AnyStateMachine, StateValue } from 'xstate';
import type { StateNodeInfo, StateNodeType } from '../core/types';

export type AnyStateNode = AnyStateMachine['root'];

export interface MachineTree {
  nodes: readonly StateNodeInfo[];
  /** Leaf id to its state node, for every atomic and final node. */
  leaves: ReadonlyMap<string, AnyStateNode>;
}

const trees = new WeakMap<AnyStateMachine, MachineTree>();

/** True for XState machines, checked by shape so a second copy of xstate still counts. */
export function isMachine(logic: unknown): logic is AnyStateMachine {
  if (typeof logic !== 'object' || logic === null) return false;
  const machine = logic as { resolveState?: unknown; root?: { states?: unknown } };

  return typeof machine.resolveState === 'function' && typeof machine.root?.states === 'object';
}

/** The machine's tree, built once per machine object. */
export function getTree(machine: AnyStateMachine): MachineTree {
  let tree = trees.get(machine);

  if (!tree) {
    const leaves = new Map<string, AnyStateNode>();
    tree = { nodes: describeChildren(machine.root, leaves), leaves };
    trees.set(machine, tree);
  }

  return tree;
}

function describeChildren(node: AnyStateNode, leaves: Map<string, AnyStateNode>): readonly StateNodeInfo[] {
  const children: StateNodeInfo[] = [];

  for (const child of childNodes(node)) {
    if (child.type === 'history') continue;
    const id = nodeId(child);

    if (child.type === 'atomic' || child.type === 'final') leaves.set(id, child);

    const info: StateNodeInfo = {
      id,
      key: child.key,
      type: child.type as StateNodeType,
      children: describeChildren(child, leaves) as StateNodeInfo[],
    };

    if (typeof child.description === 'string' && child.description !== '') info.description = child.description;

    if (child.tags.length > 0) info.tags = Object.freeze([...child.tags]) as string[];
    children.push(Object.freeze(info));
  }

  return Object.freeze(children);
}

function childNodes(node: AnyStateNode): AnyStateNode[] {
  return Object.values(node.states ?? {}) as AnyStateNode[];
}

/** Own child by key, so keys such as `constructor` don't reach the prototype. */
function childNode(node: AnyStateNode, key: string): AnyStateNode | undefined {
  const states = node.states as Record<string, AnyStateNode> | undefined;

  return states && Object.hasOwn(states, key) ? states[key] : undefined;
}

export function nodeId(node: AnyStateNode): string {
  return node.path.join('.');
}

/** Leaf ids of a state value, in the value's order: one per active atomic or final node. */
export function leavesOfValue(machine: AnyStateMachine, value: StateValue | undefined): string[] {
  const leaves: string[] = [];

  if (value !== undefined && value !== null) collectLeaves(machine.root, value, leaves);

  return leaves;
}

function collectLeaves(node: AnyStateNode, value: StateValue, into: string[]): void {
  if (typeof value === 'string') {
    const child = childNode(node, value);

    if (child) collectLeaves(child, {}, into);

    return;
  }

  if (typeof value !== 'object') return;
  const keys = Object.keys(value);

  if (keys.length === 0) {
    // An atomic child of a parallel node is `{}` in the value, and so is the root of a machine without states.
    if (node.path.length > 0 && (node.type === 'atomic' || node.type === 'final')) into.push(nodeId(node));

    return;
  }

  for (const key of keys) {
    const child = childNode(node, key);
    const childValue = value[key];

    if (child && childValue !== undefined) collectLeaves(child, childValue, into);
  }
}

/** Leaf ids of a snapshot's configuration; empty for snapshots without a value, such as an error on start. */
export function leavesOfSnapshot(machine: AnyStateMachine, snapshot: unknown): string[] {
  if (typeof snapshot !== 'object' || snapshot === null || !('value' in snapshot)) return [];

  return leavesOfValue(machine, (snapshot as AnyMachineSnapshot).value);
}
