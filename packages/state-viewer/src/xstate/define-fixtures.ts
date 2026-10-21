import type { AnyStateMachine, ContextFrom, SnapshotFrom } from 'xstate';
import type { FixtureSet } from '../core/types';
import { resolveMachineId } from './identity';
import { getTree } from './tree';

// As in xstate.ts: bundlers replace process.env.NODE_ENV, and apps may typecheck this source without Node types.
declare const process: { env: { NODE_ENV?: string } };

/**
 * Leaf ids of a state value type: `'idle' | { payment: 'error' }` gives `'idle' | 'payment.error'`. An atomic region
 * of a parallel state is `{}` in the value, so an empty object ends a path too; it's checked before anything else,
 * since `string extends {}` holds. XState's general `StateValue`, which has an index signature, gives `string`.
 */
type LeafIdsOf<TValue, TPrefix extends string = ''> = TValue extends string
  ? `${TPrefix}${TValue}`
  : TValue extends object
    ? [keyof TValue] extends [never]
      ? TPrefix extends `${infer TPath}.`
        ? TPath
        : never
      : string extends keyof TValue
        ? string
        : { [K in keyof TValue & string]-?: LeafIdsOf<TValue[K], `${TPrefix}${K}.`> }[keyof TValue & string]
    : never;

/** Leaf ids of a machine, such as `'payment.error'`. */
export type LeafIdFrom<TMachine extends AnyStateMachine> = [SnapshotFrom<TMachine>['value']] extends [never]
  ? string
  : string extends SnapshotFrom<TMachine>['value']
    ? string
    : LeafIdsOf<SnapshotFrom<TMachine>['value']>;

export type FixtureStates<TMachine extends AnyStateMachine> = {
  [TLeaf in LeafIdFrom<TMachine>]?: { context: ContextFrom<TMachine> };
};

/**
 * Hand-written context for a machine's states, keyed by leaf id. Register the result through
 * `<StateViewer fixtures>`. The set carries the machine's config as its source, which `machine.provide()` copies
 * share, so it matches instances of this machine whatever their registry id, and falls back to the machine id once
 * HMR replaces the config.
 */
export function defineFixtures<TMachine extends AnyStateMachine>(
  machine: TMachine,
  states: FixtureStates<TMachine>,
): FixtureSet {
  const set: FixtureSet = {
    machineId: resolveMachineId(machine),
    source: machine.config,
    // SAFETY: The states are keyed by leaf id, as the registry's record is. TypeScript can't relate the mapped type of
    // a generic machine to that record.
    states: states as FixtureSet['states'],
  };

  if (process.env.NODE_ENV !== 'production') warnUnknownLeaves(machine, set);

  return set;
}

/** Whether the fixtures are an object. A JavaScript app can give defineFixtures() any value. */
function isStatesObject(states: FixtureSet['states'] | null | undefined): states is FixtureSet['states'] {
  return typeof states === 'object' && states !== null;
}

function warnUnknownLeaves(machine: AnyStateMachine, set: FixtureSet): void {
  if (!isStatesObject(set.states)) return;
  const { leaves } = getTree(machine);
  const unknown = Object.keys(set.states).filter((leaf) => !leaves.has(leaf));

  if (unknown.length === 0) return;
  const list = unknown.map((leaf) => `"${leaf}"`).join(', ');
  console.warn(
    `[state-viewer] Fixtures for "${set.machineId}" name ${list}, which ${unknown.length > 1 ? "aren't leaf states" : "isn't a leaf state"} of the machine. ` +
      'Fixtures are keyed by the dot path of an atomic or final state, such as "payment.error".',
  );
}
