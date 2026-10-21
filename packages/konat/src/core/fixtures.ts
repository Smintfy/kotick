import type { FixtureSet, MachineHandle } from '../types';
import { isId } from './ids';

type FixtureTarget = Pick<MachineHandle, 'machineId' | 'source'>;

/** One fixture of a set: the context of a leaf, as defineFixtures() declares it. */
type Fixture = FixtureSet['states'][string];

/** A set as the app gave it: a machine id and an object of states, whose fixtures are checked one by one. */
interface FixtureSetInput {
  machineId: string;
  source?: unknown;
  states: object;
}

interface FixtureMatch {
  leaf: string;
  context: unknown;
}

interface FixtureStore {
  /** Adds sets; for the same machine, a later set wins per leaf id. */
  register(sets: FixtureSet[]): void;
  /** The first fixture found: requested leaves in order, then the other normalized leaves. */
  lookup(target: FixtureTarget, requested: string[], normalized: string[]): FixtureMatch | undefined;
  /** Leaf ids with a fixture for this target; the same Set until fixtures change or a new alias adds sets. */
  fixtureLeaves(target: FixtureTarget): ReadonlySet<string>;
  /**
   * Records the target's machine id as an alias of its source, when sets match the source.
   * HMR replaces the machine object, and the alias keeps the sets of the old source for the id.
   */
  recordAlias(target: FixtureTarget): void;
}

interface StoredSet {
  machineId: string;
  source: unknown;
  /** Leaf id to context, captured at registration. */
  contexts: Map<string, unknown>;
}

interface MergedFixtures {
  contexts: ReadonlyMap<string, unknown>;
  leaves: ReadonlySet<string>;
}

const NO_LEAVES: ReadonlySet<string> = new Set();
const NO_FIXTURES: MergedFixtures = { contexts: new Map(), leaves: NO_LEAVES };

export function createFixtureStore(): FixtureStore {
  const sets: StoredSet[] = [];
  // Separate caches so a primitive source can't collide with a machine id.
  const bySource = new Map<unknown, MergedFixtures>();
  const byId = new Map<string, MergedFixtures>();
  // Target machine id to every source that matched it. HMR replaces the machine object, so the id fallback takes
  // these sources' sets too; otherwise a machine under debug.id ('checkout-v2' for sets of 'checkout') loses its
  // fixtures until a reload. Keyed by the target's id, not set.machineId, so machines left on XState's default id
  // '(machine)', which get distinct generated ids, don't share sets. Never cleared: an old source stays an alias.
  const aliases = new Map<string, Set<unknown>>();

  function addAlias({ machineId, source }: FixtureTarget): void {
    let sources = aliases.get(machineId);

    if (!sources) {
      sources = new Set();
      aliases.set(machineId, sources);
    }

    if (sources.has(source)) return;
    sources.add(source);
    byId.delete(machineId);
  }

  /** The sets whose source is the target's, merged, or undefined when no set has that source. */
  function matchSource(target: FixtureTarget): MergedFixtures | undefined {
    if (!hasSource(target)) return undefined;
    const { source } = target;
    let merged = bySource.get(source);

    if (!merged) {
      const matched = sets.filter((set) => set.source === source);

      if (matched.length === 0) return undefined;
      merged = merge(matched);
      bySource.set(source, merged);
    }

    return merged;
  }

  function resolve(target: FixtureTarget): MergedFixtures {
    const sourceMatch = matchSource(target);

    if (sourceMatch) return sourceMatch;
    const { machineId } = target;
    let merged = byId.get(machineId);

    if (!merged) {
      const sources = aliases.get(machineId);
      merged = merge(sets.filter((set) => set.machineId === machineId || sources?.has(set.source) === true));
      byId.set(machineId, merged);
    }

    return merged;
  }

  return {
    register(input) {
      if (!Array.isArray(input)) {
        console.warn('[konat] Ignoring fixtures: expected an array of fixture sets.');

        return;
      }

      let added = false;
      input.forEach((value, index) => {
        if (!isFixtureSetInput(value, index)) return;
        sets.push(toStoredSet(value));
        added = true;
      });

      if (added) {
        bySource.clear();
        byId.clear();
      }
    },

    lookup(target, requested, normalized) {
      const { contexts } = resolve(target);

      if (contexts.size === 0) return undefined;

      for (const leaf of requested) {
        if (contexts.has(leaf)) return { leaf, context: contexts.get(leaf) };
      }

      // Requested leaves repeated here already came up empty, so they can't match a second time.
      for (const leaf of normalized) {
        if (contexts.has(leaf)) return { leaf, context: contexts.get(leaf) };
      }

      return undefined;
    },

    fixtureLeaves(target) {
      return resolve(target).leaves;
    },

    recordAlias(target) {
      if (matchSource(target)) addAlias(target);
    },
  };
}

// `null` counts as no source, so handles and sets that report `null` don't all match each other.
function hasSource({ source }: FixtureTarget): boolean {
  return source !== undefined && source !== null;
}

function merge(matched: StoredSet[]): MergedFixtures {
  const contexts = new Map<string, unknown>();

  for (const set of matched) {
    for (const [leaf, context] of set.contexts) contexts.set(leaf, context);
  }

  return contexts.size > 0 ? { contexts, leaves: new Set(contexts.keys()) } : NO_FIXTURES;
}

/** Whether the app gave a set that can register. The app's typing can't be relied on, so a warning says what is wrong. */
function isFixtureSetInput(value: unknown, index: number): value is FixtureSetInput {
  if (!isObject(value)) {
    console.warn(`[konat] Ignoring fixture set at index ${index}: expected an object from defineFixtures().`);

    return false;
  }

  if (!('machineId' in value) || !isId(value.machineId)) {
    console.warn(`[konat] Ignoring fixture set at index ${index}: machineId must be a non-empty string.`);

    return false;
  }

  if (!('states' in value) || !isObject(value.states)) {
    console.warn(
      `[konat] Ignoring fixture set "${value.machineId}": states must be an object keyed by leaf id.`,
    );

    return false;
  }

  return true;
}

function toStoredSet({ machineId, source, states }: FixtureSetInput): StoredSet {
  const contexts = new Map<string, unknown>();
  const fixtures: [string, unknown][] = Object.entries(states);

  for (const [leaf, fixture] of fixtures) {
    if (isFixture(fixture)) {
      contexts.set(leaf, fixture.context);
    } else {
      console.warn(`[konat] Ignoring fixture "${leaf}" for "${machineId}": expected an object with a context.`);
    }
  }

  return { machineId, source, contexts };
}

function isFixture(value: unknown): value is Fixture {
  return isObject(value) && Object.hasOwn(value, 'context');
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
