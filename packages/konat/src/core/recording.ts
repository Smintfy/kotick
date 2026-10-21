// Recording store: the latest context per state configuration, in memory and in sessionStorage.

import { isLeafId } from './ids';

const STORAGE_PREFIX = 'konat:recorded:';

/** Configurations kept per machine. */
const MAX_CONFIGURATIONS = 50;

/** Largest serialized context that gets persisted, in UTF-16 code units (what storage quotas count). */
const MAX_ENTRY_SIZE = 100_000;

/**
 * Largest combined size of every machine's stored recordings (key plus value of each `konat:recorded:` key),
 * in UTF-16 code units, so recordings leave room for the app's own data in storage.
 */
const MAX_TOTAL_SIZE = 1_000_000;

const PERSIST_INTERVAL_MS = 500;

interface RecordedEntry {
  /** Sorted leaf ids. */
  leaves: string[];
  context: unknown;
  at: number;
}

interface RecordingStore {
  /** Hot path: keeps a reference to `context` and schedules a write. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A context is the app's own data, and it has no schema.
  record(machineId: string, leaves: string[], context: unknown): void;
  /** The exact configuration first, then the most recent configuration containing a requested leaf. */
  lookup(machineId: string, requested: string[], normalized: string[]): RecordedEntry | undefined;
  /** Leaf ids contained in at least one recording; the same Set until it changes. */
  recordedLeaves(machineId: string): ReadonlySet<string>;
  /** Loads persisted recordings for a machine, once. Recordings already in memory win. */
  hydrate(machineId: string): void;
  /** Writes pending changes now. */
  flush(): void;
}

interface MachineRecordings {
  /** By configuration key, in recency order (oldest first). */
  entries: Map<string, RecordedEntry>;
  /** The entry recorded last. It is the last one in `entries` while `entries` still has it. */
  newest: RecordedEntry | undefined;
  /** Number of entries containing each leaf; leaves with no entry are absent. */
  leafCounts: Map<string, number>;
  /** `recordedLeaves`, built on demand and dropped when a leaf gains or loses its last entry. */
  leaves: ReadonlySet<string> | undefined;
  hydrated: boolean;
  dirty: boolean;
  warned: boolean;
}

const EMPTY_LEAVES: ReadonlySet<string> = new Set();

const UNSERIALIZABLE = Symbol('unserializable');

/** The object of a context that JSON.stringify is walking, or its root wrapper. */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- A context is the app's own data, and it has no schema.
type ContextHolder = Record<string, unknown>;

/** What JSON holds without loss: a string, a finite number, a boolean, or null. */
type JsonScalar = string | number | boolean | null;

/** What an actor ref has and a plain object of a context doesn't. */
interface ActorRefLike {
  send: Function;
  getSnapshot: Function;
  subscribe: Function;
}

/**
 * The stored form of an entry, or `null` when its context can't be persisted faithfully and has to stay in memory.
 * Functions held by objects are dropped. An actor ref anywhere keeps the whole context in memory, because a context
 * restored without it would crash the components that read it.
 */
function serializeEntry(entry: RecordedEntry): string | null {
  const seen = new Set<object>();
  let context: string | undefined;

  try {
    context = JSON.stringify(entry.context, function (this: ContextHolder, key: string) {
      return replaceValue(this, key, seen);
    });
  } catch {
    return null;
  }

  if (context === undefined || context.length > MAX_ENTRY_SIZE || !Number.isFinite(entry.at)) return null;

  return `{"leaves":${JSON.stringify(entry.leaves)},"at":${entry.at},"context":${context}}`;
}

function replaceValue(holder: ContextHolder, key: string, seen: Set<object>): JsonScalar | object | undefined {
  // JSON.stringify applies toJSON before the replacer sees its value argument, which would hide a Date behind a string.
  const value = holder[key];

  if (isJsonScalar(value)) return value;

  // Checked before the plain-object case below, which would otherwise persist a ref as `{}`.
  if (isActorRef(value)) throw UNSERIALIZABLE;

  if (isDroppedByJson(value)) {
    // Dropping a property is fine, but an array would get a null in its place.
    if (Array.isArray(holder)) throw UNSERIALIZABLE;

    return undefined;
  }

  if (isJsonContainer(value) && !seen.has(value)) {
    // An object reached twice would come back as two copies, so identity checks (`item === selected`) would differ.
    seen.add(value);

    return value;
  }

  throw UNSERIALIZABLE;
}

function isJsonScalar(value: unknown): value is JsonScalar {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value);
}

/** What JSON.stringify leaves out of an object. */
function isDroppedByJson(value: unknown): value is Function | undefined {
  return typeof value === 'function' || typeof value === 'undefined';
}

/** An array or a plain object, which JSON.stringify walks into. */
function isJsonContainer(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);

  return Array.isArray(value) || prototype === Object.prototype || prototype === null;
}

function isActorRef(value: unknown): value is ActorRefLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'send' in value &&
    typeof value.send === 'function' &&
    'getSnapshot' in value &&
    typeof value.getSnapshot === 'function' &&
    'subscribe' in value &&
    typeof value.subscribe === 'function'
  );
}

function defaultStorage(): Storage | null {
  try {
    // Throws a SecurityError in sandboxed frames and when site data is blocked.
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function sameLeaves(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((leaf, index) => leaf === b[index]);
}

/** What a `konat:recorded:` key holds: a version and the entries, oldest first. */
interface StoredPayload {
  v: 1;
  entries: unknown[];
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStoredPayload(value: unknown): value is StoredPayload {
  return isObject(value) && 'v' in value && value.v === 1 && 'entries' in value && Array.isArray(value.entries);
}

/** An entry of the payload. Its leaves are in the order they were written, and the reader sorts them. */
function isStoredEntry(value: unknown): value is RecordedEntry {
  return (
    isObject(value) &&
    'leaves' in value &&
    Array.isArray(value.leaves) &&
    value.leaves.every(isLeafId) &&
    'at' in value &&
    Number.isFinite(value.at) &&
    'context' in value
  );
}

/** Stored entries, oldest first, or `undefined` when nothing valid is stored. */
function readStored(storage: Storage, key: string): RecordedEntry[] | undefined {
  let payload: unknown;

  try {
    const raw = storage.getItem(key);

    if (raw === null) return undefined;
    payload = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (!isStoredPayload(payload)) return undefined;
  const entries: RecordedEntry[] = [];

  for (const item of payload.entries) {
    if (!isStoredEntry(item)) return undefined;
    entries.push({ leaves: [...item.leaves].sort(), context: item.context, at: item.at });
  }

  return entries;
}

/** Size (key plus value) of every stored recordings key, including ones written by earlier page loads. */
function readStoredSizes(storage: Storage): Map<string, number> {
  const sizes = new Map<string, number>();

  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);

      if (key === null || !key.startsWith(STORAGE_PREFIX)) continue;
      const value = storage.getItem(key);

      if (value !== null) sizes.set(key, key.length + value.length);
    }
  } catch {
    // Counted as empty: writes to storage this broken fail too, and the quota fallback handles them.
    return new Map();
  }

  return sizes;
}

const EMPTY_PAYLOAD = '{"v":1,"entries":[]}';

/** `onAvailabilityChange` is called when the set of recorded leaves for a machine changes. */
export function createRecordingStore(onAvailabilityChange: (machineId: string) => void): RecordingStore {
  const storage = defaultStorage();
  const machines = new Map<string, MachineRecordings>();
  // Persisted form of each entry, or null when its context stays in memory. Entries are never mutated.
  const serialized = new WeakMap<RecordedEntry, string | null>();
  // Sizes of the stored recordings keys, read on the first write and kept current by this store's writes.
  let storedSizes: Map<string, number> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function machineFor(machineId: string): MachineRecordings {
    let machine = machines.get(machineId);

    if (!machine) {
      machine = {
        entries: new Map(),
        newest: undefined,
        leafCounts: new Map(),
        leaves: undefined,
        hydrated: false,
        dirty: false,
        warned: false,
      };
      machines.set(machineId, machine);
    }

    return machine;
  }

  /** Returns true when a leaf gained its first entry. */
  function addLeaves(machine: MachineRecordings, leaves: string[]): boolean {
    let changed = false;

    for (const leaf of leaves) {
      const count = machine.leafCounts.get(leaf) ?? 0;
      machine.leafCounts.set(leaf, count + 1);

      if (count === 0) changed = true;
    }

    return changed;
  }

  /** Returns true when a leaf lost its last entry. */
  function removeLeaves(machine: MachineRecordings, leaves: string[]): boolean {
    let changed = false;

    for (const leaf of leaves) {
      const count = machine.leafCounts.get(leaf) ?? 0;

      if (count > 1) {
        machine.leafCounts.set(leaf, count - 1);
      } else {
        machine.leafCounts.delete(leaf);
        changed = true;
      }
    }

    return changed;
  }

  function availabilityChanged(machineId: string, machine: MachineRecordings): void {
    machine.leaves = undefined;
    onAvailabilityChange(machineId);
  }

  const record: RecordingStore['record'] = (machineId, leaves, context) => {
    const machine = machineFor(machineId);
    // Sorted, so the order of the leaves doesn't change the key. The entry keeps the sorted copy.
    const sorted = [...leaves].sort();
    const key = sorted.join('|');
    const previous = machine.entries.get(key);
    let changed = false;
    const entry: RecordedEntry = { leaves: sorted, context, at: Date.now() };

    // The newest entry is replaced in place, as a delete makes the Map rehash.
    // The instances of a list record the same configuration one after the other.
    if (previous && previous !== machine.newest) machine.entries.delete(key);
    machine.entries.set(key, entry);
    machine.newest = entry;

    if (!previous) {
      changed = addLeaves(machine, sorted);

      if (machine.entries.size > MAX_CONFIGURATIONS) {
        for (const [oldestKey, oldest] of machine.entries) {
          if (machine.entries.size <= MAX_CONFIGURATIONS) break;
          machine.entries.delete(oldestKey);
          changed = removeLeaves(machine, oldest.leaves) || changed;
        }
      }
    } else if (!sameLeaves(previous.leaves, sorted)) {
      // Two configurations share a key only when a leaf id contains `|`; the newer one replaces the older.
      changed = addLeaves(machine, sorted);
      changed = removeLeaves(machine, previous.leaves) || changed;
    }

    machine.dirty = true;

    if (storage && timer === undefined) timer = setTimeout(flush, PERSIST_INTERVAL_MS);

    if (changed) availabilityChanged(machineId, machine);
  };

  function lookup(machineId: string, requested: string[], normalized: string[]): RecordedEntry | undefined {
    const machine = machines.get(machineId);

    if (!machine) return undefined;
    const sorted = [...normalized].sort();
    const exact = machine.entries.get(sorted.join('|'));

    if (exact && sameLeaves(exact.leaves, sorted)) return exact;

    let newestFirst: RecordedEntry[] | undefined;

    for (const leaf of requested) {
      if (!machine.leafCounts.has(leaf)) continue;
      newestFirst ??= [...machine.entries.values()].reverse();
      const match = newestFirst.find((entry) => entry.leaves.includes(leaf));

      if (match) return match;
    }

    return undefined;
  }

  function recordedLeaves(machineId: string): ReadonlySet<string> {
    const machine = machines.get(machineId);

    if (!machine || machine.leafCounts.size === 0) return EMPTY_LEAVES;
    machine.leaves ??= new Set(machine.leafCounts.keys());

    return machine.leaves;
  }

  function hydrate(machineId: string): void {
    const machine = machineFor(machineId);

    if (machine.hydrated) return;
    machine.hydrated = true;

    if (!storage) return;
    const stored = readStored(storage, STORAGE_PREFIX + machineId);

    if (!stored) return;

    const restored = new Map<string, RecordedEntry>();

    for (const entry of stored) {
      const key = entry.leaves.join('|');

      if (machine.entries.has(key)) continue;
      restored.delete(key);
      restored.set(key, entry);
    }

    // Stored entries come from an earlier page load, so they rank older than everything in memory.
    const room = Math.max(0, MAX_CONFIGURATIONS - machine.entries.size);
    const kept = [...restored].slice(Math.max(0, restored.size - room));

    if (kept.length === 0) return;

    const entries = new Map(kept);
    let changed = false;

    for (const [, entry] of kept) changed = addLeaves(machine, entry.leaves) || changed;

    for (const [key, entry] of machine.entries) entries.set(key, entry);
    machine.entries = entries;

    if (changed) availabilityChanged(machineId, machine);
  }

  function persist(machineId: string, machine: MachineRecordings, target: Storage): void {
    const items: string[] = [];

    for (const entry of machine.entries.values()) {
      let item = serialized.get(entry);

      if (item === undefined) {
        item = serializeEntry(entry);
        serialized.set(entry, item);
      }

      if (item !== null) items.push(item);
    }

    const key = STORAGE_PREFIX + machineId;
    const sizes = (storedSizes ??= readStoredSizes(target));
    let budget = MAX_TOTAL_SIZE;

    for (const [storedKey, size] of sizes) if (storedKey !== key) budget -= size;

    // The newest items that fit what the other keys leave of the budget.
    let count = 0;
    let length = key.length + EMPTY_PAYLOAD.length;

    for (let i = items.length - 1; i >= 0; i--) {
      length += items[i].length + (count > 0 ? 1 : 0);

      if (length > budget) break;
      count++;
    }

    const withinBudget = count;

    // The browser's quota can still be lower than the budget, or already used up by the app.
    while (count > 0) {
      const value = `{"v":1,"entries":[${items.slice(items.length - count).join(',')}]}`;

      try {
        target.setItem(key, value);
        sizes.set(key, key.length + value.length);
        break;
      } catch {
        count = Math.floor(count / 2);
      }
    }

    if (count === 0) {
      try {
        target.removeItem(key);
        sizes.delete(key);
      } catch {
        // Nothing else to do with storage that can't be written.
      }
    }

    if (count < items.length && !machine.warned) {
      machine.warned = true;
      const saved = count === 0 ? 'none' : `only the newest ${count}`;

      const reason =
        count < withinBudget
          ? 'Storage is full or unavailable'
          : `Recordings are limited to ${MAX_TOTAL_SIZE.toLocaleString('en-US')} characters of storage in total`;

      console.warn(
        `[konat] ${reason}, so ${saved} of the ${items.length} recordings ` +
          `for "${machineId}" were saved. All of them stay available until the page reloads.`,
      );
    }
  }

  function flush(): void {
    clearTimeout(timer);
    timer = undefined;

    if (!storage) return;

    for (const [machineId, machine] of machines) {
      if (!machine.dirty) continue;
      machine.dirty = false;
      // A write replaces what's stored, so recordings from an earlier page load are merged in first.
      hydrate(machineId);
      persist(machineId, machine, storage);
    }
  }

  return { record, lookup, recordedLeaves, hydrate, flush };
}
