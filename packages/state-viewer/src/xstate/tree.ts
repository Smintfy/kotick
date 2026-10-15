// State tree, leaves and state values for XState machines.

import type { AnyMachineSnapshot, AnyStateMachine, StateValue } from 'xstate';
import type { StateNodeInfo, StateNodeType } from '../core/types';

export type AnyStateNode = AnyStateMachine['root'];

export interface MachineTree {
  /** The root's children as protocol nodes, frozen. History nodes are left out. */
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

/**
 * A nested state value naming the given leaf nodes. Atomic nodes are written as `{}`, which XState's state-value
 * resolution accepts at every level, so the value doesn't need to know which parent is compound or parallel. Keys
 * follow document order, as in snapshots XState makes itself, whatever order the leaves were asked for in.
 */
function toStateValue(nodes: readonly AnyStateNode[]): StateValue {
  const value: Record<string, Record<string, unknown>> = {};
  for (const node of [...nodes].sort((a, b) => a.order - b.order)) {
    let level: Record<string, unknown> = value;
    for (const key of node.path) {
      const next = Object.hasOwn(level, key) ? level[key] : undefined;
      if (typeof next === 'object' && next !== null) {
        level = next as Record<string, unknown>;
      } else {
        const created: Record<string, unknown> = {};
        level[key] = created;
        level = created;
      }
    }
  }
  return value as StateValue;
}

function leafNodes(tree: MachineTree, leaves: readonly string[]): AnyStateNode[] {
  return leaves.map((leaf) => {
    const node = tree.leaves.get(leaf);
    if (!node) throw new Error(`"${leaf}" is not a leaf state of this machine.`);
    return node;
  });
}

/**
 * True when two leaves can be active together: their closest common ancestor is a parallel node. A set of leaves
 * is a valid configuration when every pair is.
 */
function orthogonal(a: AnyStateNode, b: AnyStateNode): boolean {
  if (a === b) return false;
  let depth = 0;
  while (depth < a.path.length && depth < b.path.length && a.path[depth] === b.path[depth]) depth++;
  let ancestor: AnyStateNode | undefined = a;
  while (ancestor && ancestor.path.length > depth) ancestor = ancestor.parent;
  return ancestor?.type === 'parallel';
}

/**
 * Completes a preview target: requested leaves in order, skipping any that conflict with an earlier one, then
 * the current leaves of regions the request leaves alone, then the initial leaves of regions neither covers, the way
 * XState enters them. The requested leaves that were kept come first.
 */
export function normalizeLeaves(machine: AnyStateMachine, requested: readonly string[], current: readonly string[]) {
  const tree = getTree(machine);
  const kept: AnyStateNode[] = [];
  const add = (leaf: string): void => {
    const node = tree.leaves.get(leaf);
    if (node && kept.every((other) => orthogonal(other, node))) kept.push(node);
  };
  for (const leaf of requested) add(leaf);
  const requestedCount = kept.length;
  if (requestedCount === 0) return [];
  for (const leaf of current) add(leaf);

  const resolved = machine.resolveState({ value: toStateValue(kept), context: {} });
  const first = kept.slice(0, requestedCount).map(nodeId);
  return [...first, ...leavesOfValue(machine, resolved.value).filter((leaf) => !first.includes(leaf))];
}

/**
 * A real snapshot of the machine in the given configuration, through `resolveState`. Context is always passed:
 * without it XState uses `{}`, not the initial context. Throws when a leaf isn't part of the machine, or when
 * two leaves can't be active together, which an override kept across an HMR edit can ask for.
 */
export function resolveSnapshot(machine: AnyStateMachine, leaves: readonly string[], context: unknown, self?: unknown) {
  const tree = getTree(machine);
  const nodes = [...new Set(leafNodes(tree, leaves))];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (!orthogonal(nodes[i], nodes[j])) {
        throw new Error(`"${nodeId(nodes[i])}" and "${nodeId(nodes[j])}" can't be active at the same time.`);
      }
    }
  }
  let snapshot = machine.resolveState({ value: toStateValue(nodes), context: context as never }) as AnyMachineSnapshot;
  const resolved = leavesOfValue(machine, snapshot.value);
  if (resolved.length !== nodes.length) {
    // XState entered regions the leaves left out (a region HMR added) after the given ones; resolving the complete
    // configuration again puts the value's keys back in document order.
    const complete = resolved.map((leaf) => tree.leaves.get(leaf)).filter((node) => node !== undefined);
    snapshot = machine.resolveState({ value: toStateValue(complete), context: context as never }) as AnyMachineSnapshot;
  }
  if (snapshot.status === 'done' && machine.root.output !== undefined) {
    // resolveState leaves out the output a machine has once done, which components read alongside status.
    const output = machineOutput(machine, nodes, context, self);
    snapshot = machine.resolveState({ value: snapshot.value, context: context as never, output }) as AnyMachineSnapshot;
  }
  return snapshot;
}

/** Event that output mappers of a previewed final state get, since no real event led there. */
const PREVIEW_EVENT = { type: 'state-viewer.preview' };

/**
 * The machine's output in a final configuration, as XState computes it on reaching one: the root's `output`, given
 * the done event of what completed the machine, a top-level final state (with its own output) or a parallel root.
 */
function machineOutput(machine: AnyStateMachine, nodes: readonly AnyStateNode[], context: unknown, self: unknown) {
  const { root } = machine;
  try {
    const final = root.type === 'parallel' ? undefined : nodes.find((node) => node.parent === root && node.type === 'final');
    const completion = final ?? root;
    const doneOutput =
      final && final.output !== undefined ? resolveOutput(final.output, context, PREVIEW_EVENT, self) : undefined;
    const doneEvent = { type: `xstate.done.state.${completion.id}`, output: doneOutput };
    return resolveOutput(root.output, context, doneEvent, self);
  } catch (error) {
    console.warn(`[state-viewer] The output of "${machine.id}" couldn't be computed for the preview.`, error);
    return undefined;
  }
}

function resolveOutput(mapper: unknown, context: unknown, event: unknown, self: unknown): unknown {
  return typeof mapper === 'function' ? mapper({ context, event, self }) : mapper;
}
