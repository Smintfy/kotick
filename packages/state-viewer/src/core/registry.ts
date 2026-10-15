// Registry: one per page, shared by every copy of the package through globalThis.

import { createEventLog } from './event-log';
import { createFixtureStore } from './fixtures';
import { createRecordingStore } from './recording';
import type {
  DataAvailability,
  DataSource,
  DeepLinkTarget,
  MachineHandle,
  Override,
  PreviewTarget,
  Registry,
  RegistrySnapshot,
  StateNodeInfo,
} from './types';
import { VERSION } from './version';

export const REGISTRY_KEY = '__STATE_VIEWER_REGISTRY__';

type SnapshotPart = 'machines' | 'overrides' | 'log' | 'data';

/** One registration of a handle; unregister removes only the registration it came from. */
interface Registration {
  handle: MachineHandle;
}

interface ResolvedContext {
  source: DataSource;
  context: unknown;
}

const DEFAULT_SOURCE_ORDER: readonly DataSource[] = ['recorded', 'fixture', 'live'];
/**
 * The default order as a preview found it, by its source, for when fixtures register. A recording that arrived since
 * would move the preview with live traffic, so none is looked up, and a preview on a recording, which fixtures can't
 * outrank, stays. A live preview keeps the context it captured rather than taking the actor's current one.
 */
const REFRESH_ORDER: Readonly<Record<DataSource, readonly DataSource[]>> = {
  recorded: [],
  fixture: ['fixture', 'live'],
  live: ['fixture'],
};

const noop = (): void => {};

type Warn = (message: string, ...details: unknown[]) => void;

const warnInConsole: Warn = (message, ...details) => console.warn(message, ...details);

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
  const registrations = new Map<string, Registration>();
  // Keys unregistered since the last flush. Fast Refresh, StrictMode and actor swaps run an effect's cleanup and
  // then its setup in the same tick, so the registration stays in place until the flush, and a key that registers
  // again before then keeps its position and its override.
  const removing = new Set<string>();
  const overrides = new Map<string, Override>();
  // Overrides whose source the caller chose. Fixtures registering never re-resolve these. Keyed by the override, so
  // the mark goes with it when it's released, dropped or replaced.
  const chosenSource = new WeakSet<Override>();
  const overrideListeners = new Map<string, Set<() => void>>();
  // Deep links: machine id to the leaves its link previews. A link ends when preview() or release() is called for
  // one of the machine's instances, or release() releases everything, so one the user moved on from doesn't come back
  // on the machine's next instance (a new list row, a remount).
  const links = new Map<string, readonly string[]>();
  // Machines whose link has warned since it was set, so the instances of a list don't repeat the same warning.
  const linkWarned = new Set<string>();
  // Fixture loads that expectFixtures() started and that are not done yet.
  let pendingFixtureLoads = 0;
  // Instance key to the live-context warning that its preview holds until no fixture load is pending.
  // The fixtures that load can still give the preview context, so the preview warns only if they don't.
  const heldWarnings = new Map<string, () => void>();
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
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) callListener(listener, 'A registry listener threw.');
    }
  }

  /** Drops the registrations unregistered since the last flush, and their overrides. */
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
      const fixture = fixtures.fixtureLeaves(handle);
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
    for (const listener of [...set]) {
      if (set.has(listener)) callListener(listener, `An override listener for "${instanceKey}" threw.`);
    }
  }

  function register(handle: MachineHandle): () => void {
    if (!isValidHandle(handle)) {
      console.warn("[state-viewer] Can't register a machine without a non-empty machineId and instanceId.");
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
      // Matching by source now records the id's alias for its machine object, so fixtures survive HMR.
      fixtures.fixtureLeaves(handle);
      markDirty('machines');
      markDirty('data');
      if (replaced) releaseIfInvalid(key, handle);
      // Synchronously, inside the registration: a hook registers in a layout effect, so its first paint shows the link.
      applyLink(key, handle);
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
        console.warn(`[state-viewer] Releasing the preview of "${key}": ${method}() threw.`, error);
        return undefined;
      }
    };
    const valid = attempt('describe', () => validLeaves(handle));
    if (!valid || !override.leaves.every((leaf) => valid.has(leaf))) {
      releaseOverride(key);
      return;
    }
    const kept: unknown = attempt('normalizeTarget', () => handle.normalizeTarget([...override.leaves]));
    if (!Array.isArray(kept) || !override.leaves.every((leaf) => kept.includes(leaf))) {
      releaseOverride(key);
      return;
    }
    // Regions the edit added, which the preview shows: the configuration names them, as the blocked-event log does.
    const added = kept.filter((leaf): leaf is string => typeof leaf === 'string' && !override.leaves.includes(leaf));
    if (added.length === 0) return;
    const updated: Override = freeze({ ...override, leaves: freeze([...override.leaves, ...added]) });
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

  function lookupContext(
    handle: MachineHandle,
    source: DataSource,
    requested: string[],
    normalized: string[],
  ): { context: unknown } | undefined {
    switch (source) {
      case 'recorded': {
        const entry = recording.lookup(handle.machineId, requested, normalized);
        return entry && { context: entry.context };
      }
      case 'fixture': {
        const match = fixtures.lookup(handle, requested, normalized);
        return match && { context: match.context };
      }
      case 'live':
        return { context: handle.getContext() };
      default:
        return undefined;
    }
  }

  /** Context from the first source in `order` that has some. Throws when getContext() does. */
  function resolveContext(
    handle: MachineHandle,
    order: readonly DataSource[],
    requested: string[],
    leaves: string[],
  ): ResolvedContext | undefined {
    for (const source of order) {
      const found = lookupContext(handle, source, requested, leaves);
      if (found) return { source, context: found.context };
    }
    return undefined;
  }

  /** What preview() does, with its warnings going to `warn`. */
  function applyPreview(instanceKey: string, target: PreviewTarget, warn: Warn): void {
    const handle = registeredHandle(instanceKey);
    if (!handle) {
      warn(`[state-viewer] Can't preview "${instanceKey}": no machine is registered under that key.`);
      return;
    }
    if (!handle.capabilities?.preview) {
      warn(`[state-viewer] Can't preview "${instanceKey}": its adapter doesn't support previews.`);
      return;
    }
    const given: unknown[] = Array.isArray(target?.leaves) ? target.leaves : [];
    if (given.length === 0) {
      warn(`[state-viewer] Can't preview "${instanceKey}": no leaves were given.`);
      return;
    }

    let valid: ReadonlySet<string>;
    try {
      valid = validLeaves(handle);
    } catch (error) {
      warn(`[state-viewer] Can't preview "${instanceKey}": describe() threw.`, error);
      return;
    }
    const asked: string[] = [];
    const unknown: string[] = [];
    for (const leaf of new Set(given)) {
      if (typeof leaf === 'string' && valid.has(leaf)) asked.push(leaf);
      else unknown.push(`"${String(leaf)}"`);
    }
    if (unknown.length > 0) {
      const list = unknown.join(', ');
      const plural = unknown.length > 1;
      if (asked.length === 0) {
        const verb = plural ? 'are not leaf states' : 'is not a leaf state';
        warn(`[state-viewer] Can't preview "${instanceKey}": ${list} ${verb} of "${handle.machineId}".`);
        return;
      }
      const what = `not ${plural ? 'leaf states' : 'a leaf state'} of "${handle.machineId}"`;
      warn(`[state-viewer] Ignoring ${list} in the preview of "${instanceKey}": ${what}.`);
    }

    let normalized: string[];
    try {
      normalized = handle.normalizeTarget([...asked]);
    } catch (error) {
      warn(`[state-viewer] Can't preview "${instanceKey}": normalizeTarget() threw.`, error);
      return;
    }
    if (!Array.isArray(normalized)) {
      warn(`[state-viewer] Can't preview "${instanceKey}": normalizeTarget() didn't return an array.`);
      return;
    }

    // A leaf normalizeTarget dropped as conflicting isn't shown, so it stays out and can't pick the context.
    const requested = asked.filter((leaf) => normalized.includes(leaf));
    if (requested.length === 0) {
      // Nothing that was asked for would be shown, and the override would have no leaves to link to or mark.
      warn(`[state-viewer] Can't preview "${instanceKey}": normalizeTarget() kept none of the requested leaves.`);
      return;
    }
    // Requested leaves first, in the order given, so previewing the whole configuration again still resolves the
    // same context whatever order normalizeTarget returns.
    const leaves = [...requested, ...normalized.filter((leaf) => !requested.includes(leaf))];

    const explicit = target.source;
    const order =
      explicit === undefined
        ? DEFAULT_SOURCE_ORDER
        : [explicit, ...DEFAULT_SOURCE_ORDER.filter((source) => source !== explicit)];
    let resolved: ResolvedContext | undefined;
    try {
      resolved = resolveContext(handle, order, requested, leaves);
    } catch (error) {
      warn(`[state-viewer] Can't preview "${instanceKey}": getContext() threw.`, error);
      return;
    }
    // Live always has context, and the order always ends with it.
    const { source, context }: ResolvedContext = resolved ?? { source: 'live', context: undefined };

    const shown = `"${requested.join(', ')}" on "${instanceKey}"`;
    let held: (() => void) | undefined;
    if (source === 'live' && explicit !== 'live') {
      const message = `[state-viewer] No recorded or fixture context for ${shown}, so the preview uses the live context.`;
      // Only a preview on the default order takes the fixtures that register later.
      if (explicit === undefined && pendingFixtureLoads > 0) held = () => warn(message);
      else warn(message);
    } else if (explicit !== undefined && source !== explicit) {
      warn(`[state-viewer] No ${explicit} context for ${shown}, so the preview uses the ${source} context.`);
    }
    // Before the listeners are notified, because a listener can preview the instance again.
    if (held) heldWarnings.set(instanceKey, held);
    else heldWarnings.delete(instanceKey);

    const override: Override = freeze({
      instanceKey,
      requested: freeze(requested),
      leaves: freeze(leaves),
      context,
      source,
      createdAt: Date.now(),
    });
    if (explicit !== undefined) chosenSource.add(override);
    overrides.set(instanceKey, override);
    markDirty('overrides');
    notifyOverride(instanceKey);
  }

  /**
   * Resolves the context of previews left to the default order again, so one made before the fixtures loaded (a deep
   * link on page load, an early click) picks them up. The configuration stays as it was. Only fixtures registering
   * calls this, and it looks up no recordings: those would move a preview along with live traffic.
   */
  function reresolve(): void {
    for (const [key, override] of [...overrides]) {
      // A listener notified earlier in this loop can have replaced or released this one.
      if (overrides.get(key) !== override || chosenSource.has(override)) continue;
      const handle = registeredHandle(key);
      if (!handle) continue;
      let resolved: ResolvedContext | undefined;
      try {
        resolved = resolveContext(handle, REFRESH_ORDER[override.source], override.requested, override.leaves);
      } catch {
        continue;
      }
      if (!resolved || (resolved.source === override.source && Object.is(resolved.context, override.context))) continue;
      overrides.set(
        key,
        freeze({ ...override, source: resolved.source, context: resolved.context, createdAt: Date.now() }),
      );
      markDirty('overrides');
      notifyOverride(key);
    }
  }

  function expectFixtures(): () => void {
    pendingFixtureLoads++;
    let pending = true;
    // One-shot, so calling it again can't end a different load.
    return () => {
      if (!pending) return;
      pending = false;
      pendingFixtureLoads--;
      if (pendingFixtureLoads === 0) giveHeldWarnings();
    };
  }

  function giveHeldWarnings(): void {
    const held = [...heldWarnings];
    heldWarnings.clear();
    for (const [key, warn] of held) {
      if (overrides.get(key)?.source === 'live') warn();
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

  /**
   * Previews an instance with its machine's link. One with a preview keeps it: an instance that registers again before
   * the flush (StrictMode, Fast Refresh) still has the preview it had, linked or chosen since.
   */
  function applyLink(key: string, handle: MachineHandle): void {
    const leaves = links.get(handle.machineId);
    // Child machines are listed read-only, without the capability.
    if (!leaves || overrides.has(key) || !handle.capabilities?.preview) return;
    const { machineId } = handle;
    let warned = false;
    // Checked at each call, because the preview can give a held warning after another instance warned.
    const warn: Warn = (message, ...details) => {
      // Another instance of the machine warned first.
      if (!warned && linkWarned.has(machineId)) return;
      warned = true;
      linkWarned.add(machineId);
      console.warn(message, ...details);
    };
    applyPreview(key, { leaves: [...leaves] }, warn);
  }

  function link(targets: DeepLinkTarget[]): void {
    if (!Array.isArray(targets)) {
      console.warn('[state-viewer] Ignoring a deep link: expected an array of targets.');
      return;
    }
    let added = false;
    for (const target of targets) {
      if (!isLinkTarget(target)) {
        console.warn('[state-viewer] Ignoring a deep link target: expected { machineId, leaves } with string leaves.');
        continue;
      }
      links.set(target.machineId, freeze([...target.leaves]));
      linkWarned.delete(target.machineId);
      added = true;
    }
    if (!added) return;
    // Not at once, so a UI can link from the commit where its components register (React's insertion effects run
    // before every layout effect) without updating the components that show instances registered earlier.
    queueMicrotask(() => {
      for (const [key, { handle }] of [...registrations]) {
        if (!removing.has(key)) applyLink(key, handle);
      }
    });
  }

  /** Ends the link of the instance's machine: whoever previews or releases it has taken over from the link. */
  function dismissLink(instanceKey: string): void {
    const handle = registrations.get(instanceKey)?.handle;
    if (handle) links.delete(handle.machineId);
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
    preview(instanceKey, target) {
      dismissLink(instanceKey);
      applyPreview(instanceKey, target, warnInConsole);
    },
    release(instanceKey) {
      if (instanceKey === undefined) links.clear();
      else dismissLink(instanceKey);
      releaseOverride(instanceKey);
    },
    getOverride: (instanceKey) => overrides.get(instanceKey),
    onOverride,
    record(instanceKey, leaves, context) {
      const handle = registeredHandle(instanceKey);
      // A stale actor can still report after its component unmounted.
      if (handle) recording.record(handle.machineId, leaves, context);
    },
    registerFixtures(sets) {
      fixtures.register(sets);
      // Records each id's alias for its machine object before HMR can replace it, even if nothing reads the snapshot.
      for (const { handle } of registrations.values()) fixtures.fixtureLeaves(handle);
      markDirty('data');
      reresolve();
    },
    expectFixtures,
    logEvent(entry) {
      eventLog.push(entry);
      markDirty('log');
    },
    clearLog() {
      if (eventLog.size === 0) return;
      eventLog.clear();
      markDirty('log');
    },
    link,
  };
}

const EMPTY_SNAPSHOT: RegistrySnapshot = /* @__PURE__ */ freeze({
  machines: /* @__PURE__ */ freeze([]),
  overrides: /* @__PURE__ */ freeze(/* @__PURE__ */ emptyRecord()),
  log: /* @__PURE__ */ freeze([]),
  data: /* @__PURE__ */ freeze(/* @__PURE__ */ emptyRecord()),
});

/** A registry that does nothing, for the server. */
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
    registerFixtures: noop,
    expectFixtures: () => noop,
    logEvent: noop,
    clearLog: noop,
    link: noop,
  };
}

let serverRegistry: Registry | undefined;
let warnedVersion = false;

/** The page's registry, created on first use. Returns a no-op registry on the server. */
export function getRegistry(): Registry {
  // globalThis is shared by every request on a server, so a real registry there would mix up users' instances.
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    serverRegistry ??= createNoopRegistry();
    return serverRegistry;
  }
  const scope = globalThis as typeof globalThis & { [REGISTRY_KEY]?: Registry };
  const existing = scope[REGISTRY_KEY];
  if (existing) {
    if (existing.version !== VERSION && !warnedVersion) {
      warnedVersion = true;
      const other = String(existing.version);
      console.warn(
        `[state-viewer] Two versions of state-viewer are on this page (${VERSION} and ${other}). ` +
          `Both use the registry that ${other} created first; load a single copy to avoid mismatches.`,
      );
    }
    return existing;
  }
  const registry = createRegistry();
  scope[REGISTRY_KEY] = registry;
  return registry;
}

function isValidHandle(handle: MachineHandle): boolean {
  return (
    typeof handle === 'object' &&
    handle !== null &&
    typeof handle.machineId === 'string' &&
    handle.machineId !== '' &&
    typeof handle.instanceId === 'string' &&
    handle.instanceId !== ''
  );
}

function isLinkTarget(target: unknown): target is DeepLinkTarget {
  if (typeof target !== 'object' || target === null) return false;
  const { machineId, leaves } = target as { machineId?: unknown; leaves?: unknown };
  return (
    typeof machineId === 'string' &&
    machineId !== '' &&
    Array.isArray(leaves) &&
    leaves.length > 0 &&
    leaves.every((leaf) => typeof leaf === 'string')
  );
}

// Keys come from machine ids, so a null prototype keeps ids like "constructor" or "__proto__" from misbehaving.
function emptyRecord<T>(): Record<string, T> {
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

export function callListener(listener: () => void, message: string): void {
  try {
    listener();
  } catch (error) {
    console.error(`[state-viewer] ${message}`, error);
  }
}
