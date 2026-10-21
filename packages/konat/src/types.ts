export type StateNodeType = 'atomic' | 'compound' | 'parallel' | 'final';

export interface StateNodeInfo {
  /** Path from the root, such as `payment.error`. */
  id: string;
  /** Key within the parent, such as `error`. */
  key: string;
  type: StateNodeType;
  description?: string;
  tags?: string[];
  children: StateNodeInfo[];
}

export interface Capabilities {
  preview: boolean;
}

export interface MachineHandle {
  machineId: string;
  instanceId: string;
  label?: string;
  capabilities: Capabilities;
  parentKey?: string;
  /** Definition object (the XState machine), matched against `FixtureSet.source`. */
  source?: unknown;

  describe(): StateNodeInfo[];
  getActiveLeaves(): string[];
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- A context is the app's own data, and it has no schema.
  getContext(): unknown;
  /** Real state changes. */
  subscribe(onChange: () => void): () => void;
  /** Completes a target, such as filling untouched parallel regions with their current leaves. */
  normalizeTarget(leaves: string[]): string[];
}

export type DataSource = 'recorded' | 'fixture' | 'live';

export interface Override {
  /** `${machineId}#${instanceId}` */
  instanceKey: string;
  /** Leaves that were asked for, in order. */
  requested: string[];
  /** The full configuration: the requested leaves first, then the leaves filled in for untouched regions. */
  leaves: string[];
  context: unknown;
  source: DataSource;
}

export interface EventLogEntry {
  instanceKey: string;
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- An event's payload is the app's own data, and it has no schema.
  event: { type: string; [key: string]: unknown };
  /** State the UI showed when it sent the event. */
  leaves: string[];
  blocked: boolean;
  at: number;
}

export interface FixtureSet {
  machineId: string;
  /** Definition object from `defineFixtures`, matched before `machineId`. */
  source?: unknown;
  states: Record<string, { context: unknown }>;
}

export interface DataAvailability {
  /** Leaf ids contained in at least one recording. */
  recorded: ReadonlySet<string>;
  /** Leaf ids with a fixture. */
  fixture: ReadonlySet<string>;
}

export interface RegistrySnapshot {
  machines: MachineHandle[];
  overrides: Record<string, Override>;
  /** Oldest first. */
  log: EventLogEntry[];
  /** By machine id. */
  data: Record<string, DataAvailability>;
}

export interface PreviewTarget {
  leaves: string[];
  source?: DataSource;
}

/** Ends a fixture load. A second call does nothing. */
export type EndFixtureLoad = () => void;

export interface Registry {
  version: string;
  register(handle: MachineHandle): () => void;
  subscribe(listener: () => void): () => void;
  /** Immutable, and the same object until something changes, for `useSyncExternalStore`. */
  getSnapshot(): RegistrySnapshot;

  preview(instanceKey: string, target: PreviewTarget): void;
  /** Releases every instance when `instanceKey` is omitted. */
  release(instanceKey?: string): void;
  getOverride(instanceKey: string): Override | undefined;
  onOverride(instanceKey: string, listener: () => void): () => void;

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A context is the app's own data, and it has no schema.
  record(instanceKey: string, leaves: string[], context: unknown): void;
  registerFixtures(sets: FixtureSet[]): void;
  /**
   * Starts a fixture load, such as a lazy loader of `<Konat fixtures>`.
   * The caller ends the load after it registers the sets, or when the load fails.
   * While a load is pending, a preview on the default order that finds only live context holds its warning.
   * It warns when the last load ends, and only if no fixture that registered gave it context.
   */
  startFixtureLoad(): EndFixtureLoad;
  logEvent(entry: EventLogEntry): void;
  clearLog(): void;
}

export type Position = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type Theme = 'system' | 'light' | 'dark';

/** What a fixtures loader gives: the sets, or a module whose default export is them, as `import()` resolves. */
export type FixturesResult = readonly FixtureSet[] | { default: readonly FixtureSet[] };

/** Sets from `defineFixtures`, or a loader for them such as `() => import('./debug/fixtures')`. */
export type FixturesInput = readonly FixtureSet[] | (() => FixturesResult | PromiseLike<FixturesResult>);

export interface KonatProps {
  /** Corner for the toolbar and panel until the user moves them. Defaults to `'bottom-right'`. */
  position?: Position;
  /** Whether the panel starts open, until the user opens or closes it. Defaults to `false`. */
  defaultOpen?: boolean;
  /** Defaults to `'system'`. */
  theme?: Theme;
  /** Toggles the panel from anywhere, such as `'alt+s'` (the default) or `'ctrl+shift+d'`; `false` turns it off. */
  shortcut?: string | false;
  /** Fixture sets, or a loader for them, which becomes its own chunk. Wrap it in a dev check to drop it from builds. */
  fixtures?: FixturesInput;
  /** Where the overlay's host element is appended. Defaults to `document.body`. */
  portalTarget?: Element | ShadowRoot;
}
