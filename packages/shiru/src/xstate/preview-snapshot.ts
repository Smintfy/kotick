import type {
  AnyActorRef,
  AnyMachineSnapshot,
  AnyStateMachine,
  EventObject,
  MachineContext,
  Mapper,
  StateValue,
} from 'xstate';
import type { Override, PreviewLeaves } from '../types';
import { getTree, leavesOfValue, nodeId, type AnyStateNode, type MachineTree } from './tree';

interface NestedStateValue {
  [key: string]: NestedStateValue;
}

/**
 * An atomic node is `{}`, which XState's state-value resolution accepts at every level.
 * So the value does not need to know which parent is compound or parallel.
 * Keys are in document order, as in the snapshots that XState makes.
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

/** Two leaves can be active together when their closest common ancestor is a parallel node. */
function orthogonal(a: AnyStateNode, b: AnyStateNode): boolean {
  if (a === b) return false;
  let depth = 0;

  while (depth < a.path.length && depth < b.path.length && a.path[depth] === b.path[depth]) depth++;
  let ancestor: AnyStateNode | undefined = a;

  while (ancestor && ancestor.path.length > depth) ancestor = ancestor.parent;

  return ancestor?.type === 'parallel';
}

/** XState enters the initial leaves of the regions that neither the requested nor the current leaves cover. */
export function completeTarget(
  machine: AnyStateMachine,
  requested: readonly string[],
  current: readonly string[],
): PreviewLeaves {
  const tree = getTree(machine);
  const kept: AnyStateNode[] = [];

  const add = (leaf: string): void => {
    const node = tree.leaves.get(leaf);

    if (node && kept.every((other) => orthogonal(other, node))) kept.push(node);
  };

  for (const leaf of requested) add(leaf);
  const keptRequested = kept.map(nodeId);

  if (keptRequested.length === 0) return { requested: [], filled: [] };

  for (const leaf of current) add(leaf);

  const resolved = machine.resolveState({ value: toStateValue(kept), context: {} });
  const filled = leavesOfValue(machine, resolved.value).filter((leaf) => !keptRequested.includes(leaf));

  return { requested: keptRequested, filled };
}

/**
 * Without a context, `resolveState` uses `{}`, not the initial context.
 * An override kept across an HMR edit can name a leaf that the machine does not have.
 * It can also name two leaves that cannot be active together.
 * This function throws an error for both.
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

type StateOutput = AnyStateNode['output'];

type OutputMapper = Mapper<MachineContext, EventObject, unknown, EventObject>;

/** Output mappers of a previewed final state get this event, because no real event led there. */
const PREVIEW_EVENT = { type: 'shiru.preview' };

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
    console.warn(`[shiru] The output of "${machine.id}" couldn't be computed for the preview.`, error);

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
