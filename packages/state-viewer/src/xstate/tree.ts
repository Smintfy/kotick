// The state tree of an XState machine, and the leaves that a state value names.

import { isMachineSnapshot, type AnyStateMachine, type Snapshot, type StateValue } from 'xstate';
import type { StateNodeInfo } from '../core/types';

export type AnyStateNode = AnyStateMachine['root'];

export interface MachineTree {
  /** Frozen, as are the infos and their lists. The registry's types write these lists as mutable. */
  nodes: StateNodeInfo[];
  /** Leaf id to its state node, for every atomic and final node. */
  leaves: ReadonlyMap<string, AnyStateNode>;
}

const trees = new WeakMap<AnyStateMachine, MachineTree>();

/** True for XState machines, checked by shape so a second copy of xstate still counts. */
export function isMachine(logic: unknown): logic is AnyStateMachine {
  return (
    typeof logic === 'object' &&
    logic !== null &&
    'resolveState' in logic &&
    typeof logic.resolveState === 'function' &&
    'root' in logic &&
    typeof logic.root === 'object' &&
    logic.root !== null &&
    'states' in logic.root &&
    typeof logic.root.states === 'object'
  );
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

/**
 * Whether a state's description is text that the overlay can show.
 * A JavaScript machine can give any value, and React throws when it renders an object.
 */
function isDescriptionText(description: AnyStateNode['description']): description is string {
  return typeof description === 'string' && description !== '';
}

function describeChildren(node: AnyStateNode, leaves: Map<string, AnyStateNode>): StateNodeInfo[] {
  const children: StateNodeInfo[] = [];

  for (const child of childNodes(node)) {
    if (child.type === 'history') continue;
    const id = nodeId(child);

    if (child.type === 'atomic' || child.type === 'final') leaves.set(id, child);

    const info: StateNodeInfo = {
      id,
      key: child.key,
      type: child.type,
      children: describeChildren(child, leaves),
    };

    if (isDescriptionText(child.description)) info.description = child.description;

    if (child.tags.length > 0) info.tags = frozen([...child.tags]);
    children.push(Object.freeze(info));
  }

  return frozen(children);
}

/** Freezes a list that the registry's types write as mutable. The overlay reads the tree, and nothing writes to it. */
function frozen<T>(list: T[]): T[] {
  Object.freeze(list);

  return list;
}

export function childNodes(node: AnyStateNode): AnyStateNode[] {
  return Object.values(node.states);
}

/** Own child by key, so keys such as `constructor` don't reach the prototype. */
function childNode(node: AnyStateNode, key: string): AnyStateNode | undefined {
  return Object.hasOwn(node.states, key) ? node.states[key] : undefined;
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

/** A string value names one child by its key. A map names a child per key, with the value below it. */
function isChildKey(value: StateValue): value is string {
  return typeof value === 'string';
}

function collectLeaves(node: AnyStateNode, value: StateValue, into: string[]): void {
  if (isChildKey(value)) {
    const child = childNode(node, value);

    if (child) collectLeaves(child, {}, into);

    return;
  }

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
export function leavesOfSnapshot(machine: AnyStateMachine, snapshot: Snapshot<unknown>): string[] {
  return isMachineSnapshot(snapshot) ? leavesOfValue(machine, snapshot.value) : [];
}
