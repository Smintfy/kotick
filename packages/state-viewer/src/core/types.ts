// Core protocol (spec §9). Adapter-neutral: nothing in src/core may import xstate or @xstate/react.

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
  /** Live jumps (v0.2). */
  live: boolean;
  /** Can report child machines. */
  children: boolean;
}

export interface MachineHandle {
  machineId: string;
  instanceId: string;
  label?: string;
  /** Such as `xstate`. */
  adapter: string;
  capabilities: Capabilities;
  /** Set for child machines. */
  parentKey?: string;
  /** Definition object (the XState machine), matched against `FixtureSet.source`. */
  source?: unknown;

  describe(): StateNodeInfo[];
  getActiveLeaves(): string[];
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
  createdAt: number;
}

export interface EventLogEntry {
  instanceKey: string;
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

  record(instanceKey: string, leaves: string[], context: unknown): void;
  registerFixtures(sets: FixtureSet[]): void;
  logEvent(entry: EventLogEntry): void;
  clearLog(): void;
}
