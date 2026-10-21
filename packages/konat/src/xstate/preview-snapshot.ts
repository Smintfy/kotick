// What a preview of some leaves shows: the complete set of leaves, and a real snapshot of the machine in them.

import type {
  AnyActorRef,
  AnyMachineSnapshot,
  AnyStateMachine,
  EventObject,
  MachineContext,
  Mapper,
  StateValue,
} from 'xstate';
import type { Override } from '../core/types';
import { getTree, leavesOfValue, nodeId, type AnyStateNode, type MachineTree } from './tree';

/** A state value made of maps alone: an atomic node is written as `{}`. */
interface NestedStateValue {
  [key: string]: NestedStateValue;
}

/**
 * A nested state value naming the given leaf nodes. Atomic nodes are written as `{}`, which XState's state-value
 * resolution accepts at every level, so the value doesn't need to know which parent is compound or parallel. Keys
 * follow document order, as in snapshots XState makes itself, whatever order the leaves were asked for in.
 */
function toStateValue(nodes: readonly AnyStateNode[]): StateValue {
  const value: NestedStateValue = {};

  for (const node of [...nodes].sort((a, b) => a.order - b.order)) {
    let level = value;

    for (const key of node.path) {
      // Own keys only, so a state named `constructor` doesn't reach the prototype.
      if (!Object.hasOwn(level, key)) level[key] = {};
      level = level[key];
    }
  }

  return value;
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
export function completeTarget(machine: AnyStateMachine, requested: readonly string[], current: readonly string[]) {
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
export function resolveSnapshot(
  machine: AnyStateMachine,
  leaves: readonly string[],
  context: Override['context'],
  self: AnyActorRef,
): AnyMachineSnapshot {
  const tree = getTree(machine);
  const nodes = [...new Set(leafNodes(tree, leaves))];

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (!orthogonal(nodes[i], nodes[j])) {
        throw new Error(`"${nodeId(nodes[i])}" and "${nodeId(nodes[j])}" can't be active at the same time.`);
      }
    }
  }

  let snapshot = machine.resolveState({ value: toStateValue(nodes), context });
  const resolved = leavesOfValue(machine, snapshot.value);

  if (resolved.length !== nodes.length) {
    // XState entered regions the leaves left out (a region HMR added) after the given ones; resolving the complete
    // configuration again puts the value's keys back in document order.
    const complete = resolved.map((leaf) => tree.leaves.get(leaf)).filter((node) => node !== undefined);
    snapshot = machine.resolveState({ value: toStateValue(complete), context });
  }

  if (snapshot.status === 'done' && machine.root.output !== undefined) {
    // resolveState leaves out the output a machine has once done, which components read alongside status.
    const output = machineOutput(machine, nodes, context, self);
    snapshot = machine.resolveState({ value: snapshot.value, context, output });
  }

  return snapshot;
}

/** A state node's output: a mapper, which XState calls with the context, the event and the actor, or a plain value. */
type StateOutput = AnyStateNode['output'];

type OutputMapper = Mapper<MachineContext, EventObject, unknown, EventObject>;

/** Event that output mappers of a previewed final state get, since no real event led there. */
const PREVIEW_EVENT = { type: 'konat.preview' };

/**
 * The machine's output in a final configuration, as XState computes it on reaching one: the root's `output`, given
 * the done event of what completed the machine, a top-level final state (with its own output) or a parallel root.
 */
function machineOutput(
  machine: AnyStateMachine,
  nodes: readonly AnyStateNode[],
  context: Override['context'],
  self: AnyActorRef,
) {
  const { root } = machine;

  try {
    const final = root.type === 'parallel' ? undefined : nodes.find((node) => node.parent === root && node.type === 'final');
    const completion = final ?? root;

    const doneOutput =
      final && final.output !== undefined ? resolveOutput(final.output, context, PREVIEW_EVENT, self) : undefined;

    const doneEvent = { type: `xstate.done.state.${completion.id}`, output: doneOutput };

    return resolveOutput(root.output, context, doneEvent, self);
  } catch (error) {
    console.warn(`[konat] The output of "${machine.id}" couldn't be computed for the preview.`, error);

    return undefined;
  }
}

function isOutputMapper(output: StateOutput): output is OutputMapper {
  return typeof output === 'function';
}

// oxlint-disable-next-line anti-slop/no-unknown-returns -- A machine's output is the app's own value. It has no schema.
function resolveOutput(output: StateOutput, context: Override['context'], event: EventObject, self: AnyActorRef): unknown {
  if (!isOutputMapper(output)) return output;

  // SAFETY: A mapper gets the context of its machine, which XState types as an object. The override's context is the
  // app's own value for this machine: a recorded one, a fixture's, or the live one.
  // The live context is undefined for an actor that failed on start. The caller catches what a mapper throws then.
  return output({ context: context as MachineContext, event, self });
}
