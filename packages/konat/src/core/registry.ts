import type {
  DataAvailability,
  DataSource,
  FixtureSet,
  FixturesInput,
  MachineHandle,
  Override,
  PreviewLeaves,
  PreviewTarget,
  Registry,
  RegistrySnapshot,
  StateNodeInfo,
} from '../types';
import { createEventLog } from './event-log';
import { createFixtureStore, readFixtures } from './fixtures';
import { isId, isLeafId } from './ids';
import { createRecordingStore } from './recording';
import { VERSION } from './version';
import { warnOnce } from './warn-once';

export const REGISTRY_KEY = '__KONAT_REGISTRY__';

type SnapshotPart = 'machines' | 'overrides' | 'log' | 'data';

/** `${machineId}#${instanceId}`, from toInstanceKey(). */
type InstanceKey = string;

/** One registration of a handle; unregister removes only the registration it came from. */
interface Registration {
  handle: MachineHandle;
}

interface ResolvedContext {
  source: DataSource;
  context: unknown;
}

type StoredSource = Exclude<DataSource, 'live'>;

const STORED_SOURCES: readonly StoredSource[] = ['recorded', 'fixture'];

const noop = (): void => {};

export function toInstanceKey(machineId: string, instanceId: string): string {
  return `${machineId}#${instanceId}`;
}

/** Atomic and final states in document order, the ones a preview can select. */
export function leavesOf(nodes: readonly StateNodeInfo[], into: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === 'atomic' || node.type === 'final') into.push(node.id);
    leavesOf(node.children ?? [], into);
  }

  return into;
}

function createRegistry(): Registry {
  const registrations = new Map<InstanceKey, Registration>();
  // Keys unregistered since the last flush. Fast Refresh, StrictMode and actor swaps run an effect's cleanup and
  // then its setup in the same tick, so the registration stays in place until the flush, and a key that registers
  // again before then keeps its position and its override.
  const removing = new Set<InstanceKey>();
  const overrides = new Map<InstanceKey, Override>();
  // Overrides whose source the caller chose. Fixtures registering never re-resolve these. Keyed by the override, so
  // the mark goes with it when it's released, dropped or replaced.
  const chosenSource = new WeakSet<Override>();
  const overrideListeners = new Map<InstanceKey, Set<() => void>>();
  // The pending loads by input, each with the calls that wait for its sets.
  const fixtureLoads = new Map<FixturesInput, Set<object>>();
  // A fixture that is still loading can give a live preview its context, so its warning waits for the loads.
  const heldWarnings = new Map<InstanceKey, string>();
  const listeners = new Set<() => void>();
  const leafSets = new WeakMap<MachineHandle, ReadonlySet<string>>();
  const eventLog = createEventLog();
  const fixtures = createFixtureStore();
  const recording = createRecordingStore(() => markDirty('data'));

  const dirty: Record<SnapshotPart, boolean> = { machines: false, overrides: false, log: false, data: false };

  let snapshot: RegistrySnapshot = freeze({
    machines: freeze([]),
    overrides: freeze(emptyRecord()),
    log: freeze([]),
    data: freeze(emptyRecord()),
  });

  // The snapshot listeners last saw, so a flush where nothing visible changed stays quiet.
  let notified = snapshot;
  let flushScheduled = false;

  function markDirty(part: SnapshotPart): void {
    dirty[part] = true;

    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(flush);
  }

  function flush(): void {
    flushScheduled = false;
    sweep();

    if (listeners.size === 0) return;
    const current = getSnapshot();

    if (current === notified) return;
    notified = current;

    for (const listener of Array.from(listeners)) {
      if (listeners.has(listener)) callLoggingErrors(listener, 'A registry listener threw.');
    }
  }

  function sweep(): void {
    if (removing.size === 0) return;
    const keys = [...removing];
    removing.clear();

    for (const key of keys) {
      registrations.delete(key);
      releaseOverride(key);
    }
  }

  function getSnapshot(): RegistrySnapshot {
    if (!dirty.machines && !dirty.overrides && !dirty.log && !dirty.data) return snapshot;
    const previous = snapshot;
    const machines = dirty.machines ? registeredHandles(previous.machines) : previous.machines;
    const overridesRecord = dirty.overrides ? freeze(toRecord(overrides)) : previous.overrides;
    const log = dirty.log ? freeze(eventLog.toArray()) : previous.log;
    const data = dirty.data ? buildData(previous.data, machines) : previous.data;
    dirty.machines = dirty.overrides = dirty.log = dirty.data = false;

    if (
      machines !== previous.machines ||
      overridesRecord !== previous.overrides ||
      log !== previous.log ||
      data !== previous.data
    ) {
      snapshot = freeze({ machines, overrides: overridesRecord, log, data });
    }

    return snapshot;
  }

  /** Handles in registration order, or `previous` when they're the same, so a same-tick re-register stays quiet. */
  function registeredHandles(previous: MachineHandle[]): MachineHandle[] {
    const handles: MachineHandle[] = [];

    for (const [key, { handle }] of registrations) if (!removing.has(key)) handles.push(handle);
    const same = handles.length === previous.length && handles.every((handle, index) => handle === previous[index]);

    return same ? previous : freeze(handles);
  }

  /** Keeps every DataAvailability whose Sets didn't change, and the whole record when none did. */
  function buildData(
    previous: Record<string, DataAvailability>,
    handles: MachineHandle[],
  ): Record<string, DataAvailability> {
    const data = emptyRecord<DataAvailability>();
    let changed = false;

    for (const handle of handles) {
      const { machineId } = handle;

      if (machineId in data) continue;
      const recorded = recording.recordedLeaves(machineId);
      const fixture = fixtures.fixtureLeaves(handle.definitionId);
      const before = previous[machineId];

      if (before && before.recorded === recorded && before.fixture === fixture) {
        data[machineId] = before;
      } else {
        data[machineId] = freeze({ recorded, fixture });
        changed = true;
      }
    }

    if (!changed && Object.keys(data).length === Object.keys(previous).length) return previous;

    return freeze(data);
  }

  function notifyOverride(instanceKey: string): void {
    const set = overrideListeners.get(instanceKey);

    if (!set) return;

    for (const listener of Array.from(set)) {
      if (set.has(listener)) callLoggingErrors(listener, `An override listener for "${instanceKey}" threw.`);
    }
  }

  function register(handle: MachineHandle): () => void {
    if (!isValidHandle(handle)) {
      console.warn("[konat] Can't register a machine without a non-empty machineId and instanceId.");

      return noop;
    }

    const key = toInstanceKey(handle.machineId, handle.instanceId);
    let registration = registrations.get(key);
    const returning = removing.delete(key);

    if (registration?.handle !== handle || returning) {
      const replaced = registration !== undefined && registration.handle !== handle;
      // A new object even for the same handle, so the unregister of the earlier registration can't remove this one.
      registration = { handle };
      // Map.set keeps an existing key's position, so a replacement stays where the first registration was.
      registrations.set(key, registration);
      recording.hydrate(handle.machineId);
      markDirty('machines');
      markDirty('data');

      if (replaced) releaseIfInvalid(key, handle);
    }

    const current = registration;

    return () => {
      // A stale cleanup can run after another registration replaced this one under the same key.
      if (registrations.get(key) !== current || removing.has(key)) return;
      removing.add(key);
      markDirty('machines');
      markDirty('data');
    };
  }

  /**
   * Releases an override the instance's new handle can't render: one that names a leaf its tree doesn't have, or
   * leaves it can't have active together (a parallel state edited into a compound one), which normalizeTarget drops.
   * One it can render takes the leaves normalizeTarget adds for regions the edit added.
   */
  function releaseIfInvalid(key: string, handle: MachineHandle): void {
    const override = overrides.get(key);

    if (!override) return;

    const attempt = <T>(method: string, fn: () => T): T | undefined => {
      try {
        return fn();
      } catch (error) {
        console.warn(`[konat] Releasing the preview of "${key}": ${method}() threw.`, error);

        return undefined;
      }
    };

    const valid = attempt('describe', () => validLeaves(handle));

    if (!valid || !override.leaves.every((leaf) => valid.has(leaf))) {
      releaseOverride(key);

      return;
    }

    const completed: unknown = attempt('normalizeTarget', () => handle.normalizeTarget([...override.leaves]));

    if (!isPreviewLeaves(completed) || !override.leaves.every((leaf) => completed.requested.includes(leaf))) {
      releaseOverride(key);

      return;
    }

    if (completed.filled.length === 0) return;
    const leaves = { requested: override.requested, filled: [...override.filled, ...completed.filled] };
    const updated = toOverride(key, leaves, { source: override.source, context: override.context });

    if (chosenSource.has(override)) chosenSource.add(updated);
    overrides.set(key, updated);
    markDirty('overrides');
    notifyOverride(key);
  }

  function registeredHandle(key: string): MachineHandle | undefined {
    return removing.has(key) ? undefined : registrations.get(key)?.handle;
  }

  function subscribe(listener: () => void): () => void {
    // Subscribers read the snapshot themselves, so changes made while nobody listened aren't owed a notification.
    if (listeners.size === 0) notified = getSnapshot();
    listeners.add(listener);
    let active = true;

    // One-shot, so calling it again can't remove a later subscription of the same function.
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
    };
  }

  function validLeaves(handle: MachineHandle): ReadonlySet<string> {
    let leaves = leafSets.get(handle);

    if (!leaves) {
      leaves = new Set(leavesOf(handle.describe()));
      leafSets.set(handle, leaves);
    }

    return leaves;
  }

  function lookupStored(
    handle: MachineHandle,
    source: StoredSource,
    leaves: PreviewLeaves,
  ): ResolvedContext | undefined {
    switch (source) {
      case 'recorded': {
        const { requested, filled } = leaves;
        const entry = recording.lookup(handle.machineId, requested, [...requested, ...filled]);

        return entry && { source, context: entry.context };
      }

      case 'fixture': {
        const match = fixtures.lookup(handle.definitionId, leaves);

        return match && { source, context: match.context };
      }

      default:
        return undefined;
    }
  }

  function resolveContext(
    handle: MachineHandle,
    explicit: DataSource | undefined,
    leaves: PreviewLeaves,
  ): ResolvedContext {
    if (explicit !== 'live') {
      const order =
        explicit === undefined ? STORED_SOURCES : [explicit, ...STORED_SOURCES.filter((source) => source !== explicit)];

      for (const source of order) {
        const found = lookupStored(handle, source, leaves);

        if (found) return found;
      }
    }

    return { source: 'live', context: handle.getContext() };
  }

  function applyPreview(instanceKey: string, target: PreviewTarget): void {
    const handle = registeredHandle(instanceKey);

    if (!handle) {
      console.warn(`[konat] Can't preview "${instanceKey}": no machine is registered under that key.`);

      return;
    }

    if (!handle.capabilities?.preview) {
      console.warn(`[konat] Can't preview "${instanceKey}": its adapter doesn't support previews.`);

      return;
    }

    const given: unknown[] = Array.isArray(target?.leaves) ? target.leaves : [];

    if (given.length === 0) {
      console.warn(`[konat] Can't preview "${instanceKey}": no leaves were given.`);

      return;
    }

    let valid: ReadonlySet<string>;

    try {
      valid = validLeaves(handle);
    } catch (error) {
      console.warn(`[konat] Can't preview "${instanceKey}": describe() threw.`, error);

      return;
    }

    const asked: string[] = [];
    const unknown: string[] = [];

    for (const leaf of new Set(given)) {
      if (isLeafId(leaf) && valid.has(leaf)) asked.push(leaf);
      else unknown.push(`"${String(leaf)}"`);
    }

    if (unknown.length > 0) {
      const list = unknown.join(', ');
      const plural = unknown.length > 1;

      if (asked.length === 0) {
        const verb = plural ? 'are not leaf states' : 'is not a leaf state';
        console.warn(`[konat] Can't preview "${instanceKey}": ${list} ${verb} of "${handle.machineId}".`);

        return;
      }

      const what = `not ${plural ? 'leaf states' : 'a leaf state'} of "${handle.machineId}"`;
      console.warn(`[konat] Ignoring ${list} in the preview of "${instanceKey}": ${what}.`);
    }

    let leaves: unknown;

    try {
      leaves = handle.normalizeTarget([...asked]);
    } catch (error) {
      console.warn(`[konat] Can't preview "${instanceKey}": normalizeTarget() threw.`, error);

      return;
    }

    if (!isPreviewLeaves(leaves)) {
      console.warn(
        `[konat] Can't preview "${instanceKey}": normalizeTarget() didn't return the requested and filled leaves.`,
      );

      return;
    }

    if (leaves.requested.length === 0) {
      console.warn(`[konat] Can't preview "${instanceKey}": normalizeTarget() kept none of the requested leaves.`);

      return;
    }

    const explicit = target.source;
    let resolved: ResolvedContext;

    try {
      resolved = resolveContext(handle, explicit, leaves);
    } catch (error) {
      console.warn(`[konat] Can't preview "${instanceKey}": getContext() threw.`, error);

      return;
    }

    const { source } = resolved;
    const shown = `"${leaves.requested.join(', ')}" on "${instanceKey}"`;
    let held: string | undefined;

    if (source === 'live' && explicit !== 'live') {
      const message = `[konat] No recorded or fixture context for ${shown}, so the preview uses the live context.`;

      // Only a preview on the default order takes the fixtures that register later.
      if (explicit === undefined && fixtureLoads.size > 0) held = message;
      else console.warn(message);
    } else if (explicit !== undefined && source !== explicit) {
      console.warn(`[konat] No ${explicit} context for ${shown}, so the preview uses the ${source} context.`);
    }

    // Before the listeners are notified, because a listener can preview the instance again.
    if (held === undefined) heldWarnings.delete(instanceKey);
    else heldWarnings.set(instanceKey, held);

    const override = toOverride(instanceKey, leaves, resolved);

    if (explicit !== undefined) chosenSource.add(override);
    overrides.set(instanceKey, override);
    markDirty('overrides');
    notifyOverride(instanceKey);
  }

  /**
   * Gives new fixtures to the previews on the default order, such as a click before the fixtures loaded.
   * It looks up no recordings, because a recording would move the preview with live traffic.
   * A live preview keeps the context that it captured.
   */
  function applyFixtures(): void {
    for (const [key, override] of Array.from(overrides)) {
      // A listener notified earlier in this loop can have replaced or released this one.
      if (overrides.get(key) !== override || chosenSource.has(override) || override.source === 'recorded') continue;
      const handle = registeredHandle(key);

      if (!handle) continue;
      let resolved = lookupStored(handle, 'fixture', override);

      if (!resolved && override.source === 'fixture') {
        try {
          resolved = { source: 'live', context: handle.getContext() };
        } catch {
          continue;
        }
      }

      if (!resolved || (resolved.source === override.source && Object.is(resolved.context, override.context))) continue;
      overrides.set(key, freeze({ ...override, ...resolved }));
      markDirty('overrides');
      notifyOverride(key);
    }
  }

  function registerFixtures(sets: readonly FixtureSet[]): void {
    if (!fixtures.register(sets)) return;
    markDirty('data');
    applyFixtures();
  }

  function loadFixtures(input: FixturesInput): () => void {
    const waiting = fixtureLoads.get(input) ?? startFixtureLoad(input);
    const call = {};
    waiting.add(call);

    return () => {
      waiting.delete(call);
    };
  }

  function startFixtureLoad(input: FixturesInput): Set<object> {
    const waiting = new Set<object>();
    fixtureLoads.set(input, waiting);
    void readFixtures(input)
      .then((sets) => {
        if (waiting.size > 0) registerFixtures(sets);
      })
      .finally(() => {
        fixtureLoads.delete(input);

        if (fixtureLoads.size === 0) giveHeldWarnings();
      });

    return waiting;
  }

  function giveHeldWarnings(): void {
    const held = [...heldWarnings];
    heldWarnings.clear();

    for (const [key, message] of held) {
      if (overrides.get(key)?.source === 'live') console.warn(message);
    }
  }

  function releaseOverride(instanceKey?: string): void {
    if (instanceKey !== undefined) {
      heldWarnings.delete(instanceKey);

      if (!overrides.delete(instanceKey)) return;
      markDirty('overrides');
      notifyOverride(instanceKey);

      return;
    }

    heldWarnings.clear();

    if (overrides.size === 0) return;
    const released = [...overrides.keys()];
    overrides.clear();
    markDirty('overrides');

    for (const key of released) notifyOverride(key);
  }

  function onOverride(instanceKey: string, listener: () => void): () => void {
    let set = overrideListeners.get(instanceKey);

    if (!set) {
      set = new Set();
      overrideListeners.set(instanceKey, set);
    }

    set.add(listener);
    let active = true;

    return () => {
      if (!active) return;
      active = false;
      const current = overrideListeners.get(instanceKey);

      if (!current?.delete(listener)) return;

      if (current.size === 0) overrideListeners.delete(instanceKey);
    };
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.addEventListener('pagehide', () => recording.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') recording.flush();
    });
  }

  return {
    version: VERSION,
    register,
    subscribe,
    getSnapshot,
    preview: applyPreview,
    release: releaseOverride,
    getOverride: (instanceKey) => overrides.get(instanceKey),
    onOverride,
    record(instanceKey, leaves, context) {
      const handle = registeredHandle(instanceKey);

      // A stale actor can still report after its component unmounted.
      if (handle) recording.record(handle.machineId, leaves, context);
    },
    loadFixtures,
    logEvent(entry) {
      eventLog.push(entry);
      markDirty('log');
    },
    clearLog() {
      if (eventLog.size === 0) return;
      eventLog.clear();
      markDirty('log');
    },
  };
}

const EMPTY_SNAPSHOT: RegistrySnapshot = /* @__PURE__ */ freeze({
  machines: /* @__PURE__ */ freeze([]),
  overrides: /* @__PURE__ */ freeze(/* @__PURE__ */ emptyRecord()),
  log: /* @__PURE__ */ freeze([]),
  data: /* @__PURE__ */ freeze(/* @__PURE__ */ emptyRecord()),
});

function createNoopRegistry(): Registry {
  return {
    version: VERSION,
    register: () => noop,
    subscribe: () => noop,
    getSnapshot: () => EMPTY_SNAPSHOT,
    preview: noop,
    release: noop,
    getOverride: () => undefined,
    onOverride: () => noop,
    record: noop,
    loadFixtures: () => noop,
    logEvent: noop,
    clearLog: noop,
  };
}

let serverRegistry: Registry | undefined;

export function getPageRegistry(): Registry {
  // globalThis is shared by every request on a server, so a real registry there would mix up users' instances.
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    serverRegistry ??= createNoopRegistry();

    return serverRegistry;
  }

  // SAFETY: Only konat writes this key of globalThis, and each version writes its Registry there.
  // The code below compares the version of the registry that it finds.
  const scope = globalThis as typeof globalThis & { [REGISTRY_KEY]?: Registry };
  const existing = scope[REGISTRY_KEY];

  if (existing) {
    if (existing.version !== VERSION) {
      const other = String(existing.version);
      warnOnce(
        'version',
        `[konat] Two versions of konat are on this page (${VERSION} and ${other}). ` +
          `Both use the registry that ${other} created first; load a single copy to avoid mismatches.`,
      );
    }

    return existing;
  }

  const registry = createRegistry();
  scope[REGISTRY_KEY] = registry;

  return registry;
}

function toOverride(instanceKey: string, { requested, filled }: PreviewLeaves, resolved: ResolvedContext): Override {
  return freeze({
    instanceKey,
    requested: freeze([...requested]),
    filled: freeze([...filled]),
    leaves: freeze([...requested, ...filled]),
    context: resolved.context,
    source: resolved.source,
  });
}

function isPreviewLeaves(value: unknown): value is PreviewLeaves {
  return (
    typeof value === 'object' &&
    value !== null &&
    'requested' in value &&
    Array.isArray(value.requested) &&
    'filled' in value &&
    Array.isArray(value.filled)
  );
}

// A JS app can register anything, so the ids are read through `?.` and checked.
function isValidHandle(handle: MachineHandle): boolean {
  return isId(handle?.machineId) && isId(handle?.instanceId);
}

// Keys come from machine ids, so a null prototype keeps ids like "constructor" or "__proto__" from misbehaving.
function emptyRecord<T>(): Record<string, T> {
  // SAFETY: An object with no prototype and no keys is an empty record, whatever the type of its values.
  return Object.create(null) as Record<string, T>;
}

function toRecord<T>(map: Map<string, T>): Record<string, T> {
  const record = emptyRecord<T>();

  for (const [key, value] of map) record[key] = value;

  return record;
}

function freeze<T extends object>(value: T): T {
  Object.freeze(value);

  return value;
}

export function callLoggingErrors(listener: () => void, message: string): void {
  try {
    listener();
  } catch (error) {
    console.error(`[konat] ${message}`, error);
  }
}
