export type StateNodeType = 'atomic' | 'compound' | 'parallel' | 'final';

export interface StateNodeInfo {
  /** Path from the root, such as `payment.error`. */
  id: string;
  /** Key within the parent, such as `error`. */
  key: string;
  type: StateNodeType;
  children: StateNodeInfo[];
}

export interface Capabilities {
  preview: boolean;
  /**
   * Whether all states of the machine share one context.
   * It is true for XState, where the live context fits a preview of any state.
   * It is false for a union of states, where the live context fits only the state that the machine is in.
   */
  sharedContext: boolean;
}

export interface MachineHandle {
  machineId: string;
  instanceId: string;
  label?: string;
  capabilities: Capabilities;
  parentKey?: string;
  /**
   * The machine's own id, which `debug.id` doesn't change.
   * Fixture sets match it by their `machineId`.
   */
  definitionId: string;

  describe(): StateNodeInfo[];
  getActiveLeaves(): string[];
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- A context is the app's own data, and it has no schema.
  getContext(): unknown;
  /** Real state changes. */
  subscribe(onChange: () => void): () => void;
  normalizeTarget(leaves: string[]): PreviewLeaves;
}

export type DataSource = 'recorded' | 'fixture' | 'live';

export interface PreviewLeaves {
  /** The leaves that were asked for and can be active together, in the order given. */
  requested: string[];
  /** The leaves of the regions that `requested` leaves alone: their current leaves, or else their initial leaves. */
  filled: string[];
}

export interface Override extends PreviewLeaves {
  /** `${machineId}#${instanceId}` */
  instanceKey: string;
  /** `requested`, then `filled`. */
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
  at: number;
}

export interface FixtureSet {
  machineId: string;
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
  /**
   * An earlier leaf wins over a later one.
   * A later leaf that can't be active with an earlier one is dropped, and context comes from the earlier leaves first.
   */
  leaves: string[];
  source?: DataSource;
}

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
  /**
   * Loads the sets, or joins the pending load of the same input, and returns a function that cancels this call.
   * When the load ends, its sets register only if a call that has not been cancelled waits for them.
   */
  loadFixtures(input: FixturesInput): () => void;
  logEvent(entry: EventLogEntry): void;
  clearLog(): void;
}

export type Position = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** What a fixtures loader gives: the sets, or a module whose default export is them, as `import()` resolves. */
export type FixturesResult = readonly FixtureSet[] | { default: readonly FixtureSet[] };

/** Sets from `defineFixtures`, or a loader for them such as `() => import('./debug/fixtures')`. */
export type FixturesInput = readonly FixtureSet[] | (() => FixturesResult | PromiseLike<FixturesResult>);

export interface KotickProps {
  /** Corner for the toolbar and panel until the user moves them. Defaults to `'bottom-right'`. */
  position?: Position;
  /** Whether the panel starts open, until the user opens or closes it. Defaults to `false`. */
  defaultOpen?: boolean;
  /**
   * Toggles the panel from anywhere, such as `'alt+s'` (the default) or `'ctrl+shift+d'`; `false` turns it off.
   * `mod` is ⌘ on macOS and Ctrl on other systems. The overlay writes the keys as the system does, such as ⌥S on macOS.
   */
  shortcut?: string | false;
  /** Fixture sets, or a loader for them, which becomes its own chunk. Wrap it in a dev check to drop it from builds. */
  fixtures?: FixturesInput;
  /** Where the overlay's host element is appended. Defaults to `document.body`. */
  portalTarget?: Element | ShadowRoot;
}
