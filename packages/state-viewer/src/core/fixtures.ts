// Fixture registry (spec §10.3, D10, D11).

import type { FixtureSet, MachineHandle } from './types';

export type FixtureTarget = Pick<MachineHandle, 'machineId' | 'source'>;

export interface FixtureMatch {
  leaf: string;
  context: unknown;
}

export interface FixtureStore {
  /** Adds sets; for the same machine, a later set wins per leaf id. */
  register(sets: FixtureSet[]): void;
  /** The first fixture found: requested leaves in order, then the other normalized leaves. */
  lookup(target: FixtureTarget, requested: string[], normalized: string[]): FixtureMatch | undefined;
  /** Leaf ids with a fixture for this target; the same Set until fixtures change or a new alias adds sets. */
  fixtureLeaves(target: FixtureTarget): ReadonlySet<string>;
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

  function addAlias(machineId: string, source: unknown): void {
    let sources = aliases.get(machineId);
    if (!sources) {
      sources = new Set();
      aliases.set(machineId, sources);
    }
    if (sources.has(source)) return;
    sources.add(source);
    byId.delete(machineId);
  }

  function resolve({ machineId, source }: FixtureTarget): MergedFixtures {
    if (hasSource(source)) {
      let merged = bySource.get(source);
      if (!merged) {
        const matched = sets.filter((set) => set.source === source);
        if (matched.length > 0) {
          merged = merge(matched);
          bySource.set(source, merged);
        }
      }
      if (merged) {
        addAlias(machineId, source);
        return merged;
      }
    }
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
        console.warn('[state-viewer] Ignoring fixtures: expected an array of fixture sets.');
        return;
      }
      let added = false;
      input.forEach((value: unknown, index) => {
        const set = toStoredSet(value, index);
        if (!set) return;
        sets.push(set);
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
  };
}

// `null` counts as no source, so handles and sets that report `null` don't all match each other.
function hasSource(source: unknown): boolean {
  return source !== undefined && source !== null;
}

function merge(matched: StoredSet[]): MergedFixtures {
  const contexts = new Map<string, unknown>();
  for (const set of matched) {
    for (const [leaf, context] of set.contexts) contexts.set(leaf, context);
  }
  return contexts.size > 0 ? { contexts, leaves: new Set(contexts.keys()) } : NO_FIXTURES;
}

function toStoredSet(value: unknown, index: number): StoredSet | undefined {
  if (!isRecord(value)) {
    console.warn(`[state-viewer] Ignoring fixture set at index ${index}: expected an object from defineFixtures().`);
    return undefined;
  }
  const { machineId, source, states } = value;
  if (typeof machineId !== 'string' || machineId === '') {
    console.warn(`[state-viewer] Ignoring fixture set at index ${index}: machineId must be a non-empty string.`);
    return undefined;
  }
  if (!isRecord(states)) {
    console.warn(`[state-viewer] Ignoring fixture set "${machineId}": states must be an object keyed by leaf id.`);
    return undefined;
  }
  const contexts = new Map<string, unknown>();
  for (const [leaf, entry] of Object.entries(states)) {
    if (isRecord(entry) && Object.hasOwn(entry, 'context')) {
      contexts.set(leaf, entry.context);
    } else {
      console.warn(`[state-viewer] Ignoring fixture "${leaf}" for "${machineId}": expected an object with a context.`);
    }
  }
  return { machineId, source, contexts };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
