import type { FixtureSet, FixturesInput, PreviewLeaves } from '../types';
import { isId } from './ids';

type Fixture = FixtureSet['states'][string];

interface FixtureSetInput {
  machineId: string;
  states: object;
}

interface FixtureMatch {
  context: unknown;
}

interface FixtureStore {
  /**
   * Skips the sets that it registered before.
   * Returns whether the fixtures changed.
   */
  register(sets: readonly FixtureSet[]): boolean;
  lookup(definitionId: string, leaves: PreviewLeaves): FixtureMatch | undefined;
  /** The same Set until the fixtures of `definitionId` change. */
  fixtureLeaves(definitionId: string): ReadonlySet<string>;
}

interface MachineFixtures {
  /** Leaf id to context, captured at registration. */
  contexts: ReadonlyMap<string, unknown>;
  leaves: ReadonlySet<string>;
}

const NO_LEAVES: ReadonlySet<string> = new Set();

export function createFixtureStore(): FixtureStore {
  const byMachine = new Map<string, MachineFixtures>();
  const registered = new WeakSet<FixtureSet>();

  return {
    register(sets) {
      let changed = false;

      sets
        .filter((set) => !registered.has(set))
        .forEach((value, index) => {
          registered.add(value);

          if (!isFixtureSetInput(value, index)) return;
          const added = fixturesOf(value);

          if (added.length === 0) return;
          const contexts = new Map([...(byMachine.get(value.machineId)?.contexts ?? []), ...added]);
          byMachine.set(value.machineId, { contexts, leaves: new Set(contexts.keys()) });
          changed = true;
        });

      return changed;
    },

    lookup(definitionId, { requested, filled }) {
      const contexts = byMachine.get(definitionId)?.contexts;

      if (!contexts) return undefined;
      const leaf = requested.find((id) => contexts.has(id)) ?? filled.find((id) => contexts.has(id));

      return leaf === undefined ? undefined : { context: contexts.get(leaf) };
    },

    fixtureLeaves(definitionId) {
      return byMachine.get(definitionId)?.leaves ?? NO_LEAVES;
    },
  };
}

export async function readFixtures(input: FixturesInput): Promise<FixtureSet[]> {
  let result: unknown;

  try {
    result = isLoader(input) ? await input() : input;
  } catch (error) {
    console.warn('[shiru] The fixtures loader failed.', error);

    return [];
  }

  if (hasDefaultExport(result)) result = result.default;

  if (!Array.isArray(result)) {
    console.warn(
      '[shiru] Expected fixtures to be an array of sets from defineFixtures(), ' +
        'or a module whose default export is one.',
    );

    return [];
  }

  const sets = result.filter(isFixtureSet);

  if (sets.length < result.length) {
    console.warn('[shiru] Ignoring fixture entries that are not sets from defineFixtures().');
  }

  return sets;
}

function isLoader(input: FixturesInput): input is Exclude<FixturesInput, readonly FixtureSet[]> {
  return typeof input === 'function';
}

function hasDefaultExport(value: unknown): value is { default: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'default' in value;
}

function isFixtureSet(value: unknown): value is FixtureSet {
  return (
    typeof value === 'object' &&
    value !== null &&
    'machineId' in value &&
    typeof value.machineId === 'string' &&
    'states' in value &&
    typeof value.states === 'object' &&
    value.states !== null
  );
}

/** The app's typing can't be relied on, so a warning says what is wrong. */
function isFixtureSetInput(value: unknown, index: number): value is FixtureSetInput {
  if (!isObject(value)) {
    console.warn(`[shiru] Ignoring fixture set at index ${index}: expected an object from defineFixtures().`);

    return false;
  }

  if (!('machineId' in value) || !isId(value.machineId)) {
    console.warn(`[shiru] Ignoring fixture set at index ${index}: machineId must be a non-empty string.`);

    return false;
  }

  if (!('states' in value) || !isObject(value.states)) {
    console.warn(
      `[shiru] Ignoring fixture set "${value.machineId}": states must be an object keyed by leaf id.`,
    );

    return false;
  }

  return true;
}

function fixturesOf({ machineId, states }: FixtureSetInput): [string, unknown][] {
  const fixtures: [string, unknown][] = [];
  const entries: [string, unknown][] = Object.entries(states);

  for (const [leaf, fixture] of entries) {
    if (isFixture(fixture)) {
      fixtures.push([leaf, fixture.context]);
    } else {
      console.warn(`[shiru] Ignoring fixture "${leaf}" for "${machineId}": expected an object with a context.`);
    }
  }

  return fixtures;
}

function isFixture(value: unknown): value is Fixture {
  return isObject(value) && Object.hasOwn(value, 'context');
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
