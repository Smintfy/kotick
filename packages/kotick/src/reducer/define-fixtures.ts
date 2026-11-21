// The app's fixtures file imports this module, and only the development loader of <Kotick fixtures> imports that file.
// Production code that imports it keeps a small function, and its warnings sit behind a NODE_ENV check.

import type { FixtureSet } from '../types';
import { isDeclared, isStateOf, type MachineEvent, type ReducerMachine, type StateName, type StateNamed } from './machine';

// Declared here rather than through @types/node, so apps that typecheck this source without Node types still compile.
declare const process: { env: { NODE_ENV?: string } };

/**
 * A state object for any state of the machine, and no other key.
 * A preview of a state gives the component its object. A state without one previews from a recording.
 */
export type ReducerFixtures<State, Key extends keyof State> = {
  readonly [Name in StateName<State, Key>]?: StateNamed<State, Key, Name>;
};

/**
 * The fixtures of a machine, with a state object for every state.
 * Check a set with `satisfies CompleteFixtures<typeof machine>`, and the file fails when a state has no fixture.
 */
export type CompleteFixtures<Machine> =
  Machine extends ReducerMachine<infer State, infer _Event, infer Key, infer _Input>
    ? Required<ReducerFixtures<State, Key>>
    : never;

/**
 * Makes a fixture set for `<Kotick fixtures>`. It applies to every instance of the machine.
 * The types reject a fixture of another state and a name that isn't a state.
 * A JavaScript app gets no type check, so the set leaves out such a fixture, and the registry never previews it.
 */
export function defineFixtures<State extends object, Event extends MachineEvent, Key extends keyof State, Input>(
  machine: ReducerMachine<State, Event, Key, Input>,
  fixtures: ReducerFixtures<State, Key>,
): FixtureSet {
  const kept: [string, { context: State }][] = [];

  for (const [name, state] of Object.entries(fixtures)) {
    const declared = isDeclared(machine, name);

    if (declared && isStateOf(machine, state, name)) {
      kept.push([name, { context: state }]);
      continue;
    }

    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        declared
          ? `[kotick] The fixture of "${name}" on "${machine.id}" isn't in the "${name}" state, so the set leaves it out.`
          : `[kotick] "${machine.id}" has no state "${name}", so the set leaves its fixture out.`,
      );
    }
  }

  return { machineId: machine.id, states: Object.fromEntries(kept) };
}
