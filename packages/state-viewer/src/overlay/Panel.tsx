// The panel: header with the machine and instance pickers, the state tree, context, the event log, and
// a footer to copy a link or the state as JSON. Keyboard shortcuts that need focus in the panel are handled here.

import * as React from 'react';
import { writeDeepLink } from '../core/deep-link';
import type { DataAvailability, DataSource, Registry, RegistrySnapshot, StateNodeInfo } from '../core/types';
import { copyText } from './clipboard';
import { ContextView } from './ContextView';
import { EventLog } from './EventLog';
import { toJson } from './format';
import { useHandleUpdates, useIsomorphicLayoutEffect } from './hooks';
import { CloseIcon, CornerIcon } from './icons';
import { findInstance, leavesOf, planLink, toggleLeaf, type InstanceEntry, type MachineGroup } from './model';
import { isTyping } from './shortcut';
import { DataMark, StateTree } from './StateTree';

const EMPTY_DATA: DataAvailability = { recorded: new Set(), fixture: new Set() };

type Move = 'next' | 'previous' | 'first' | 'last';

const MOVES: Readonly<Record<'ArrowDown' | 'ArrowUp' | 'Home' | 'End', Move>> = {
  ArrowDown: 'next',
  ArrowUp: 'previous',
  Home: 'first',
  End: 'last',
};
const NO_NODES: StateNodeInfo[] = [];

interface PanelProps {
  id: string;
  registry: Registry;
  snapshot: RegistrySnapshot;
  groups: readonly MachineGroup[];
  group: MachineGroup | undefined;
  instance: InstanceEntry | undefined;
  urlParam: string;
  /** Shown in the close button's tooltip, such as 'Alt+S'. */
  shortcutLabel: string | undefined;
  panelRef: React.Ref<HTMLElement>;
  onSelectMachine(machineId: string): void;
  onSelectInstance(instanceKey: string): void;
  onCycleMachine(step: 1 | -1): void;
  onMove(): void;
  onClose(): void;
}

export function Panel(props: PanelProps) {
  const { registry, snapshot, groups, group, instance } = props;
  const handle = instance?.handle;
  const key = instance?.key;
  useHandleUpdates(handle);

  const override = key === undefined ? undefined : snapshot.overrides[key];
  const canPreview = handle?.capabilities?.preview === true;
  const nodes = React.useMemo(() => (handle ? attempt(() => handle.describe(), NO_NODES) : NO_NODES), [handle]);
  const leaves = React.useMemo(() => leavesOf(nodes), [nodes]);
  // Read on every render: the handle's updates re-render the panel, the registry snapshot doesn't change for them.
  const active = new Set<string>(handle ? attempt(() => handle.getActiveLeaves(), []) : []);
  const liveContext = handle ? attempt(() => handle.getContext(), undefined) : undefined;
  const data = (handle && snapshot.data[handle.machineId]) || EMPTY_DATA;
  const previewCount = Object.keys(snapshot.overrides).length;

  // The leaf keyboard navigation is on: the one last moved to or clicked, else the previewed, live or first leaf.
  const [cursorState, setCursor] = React.useState<string>();
  const cursor =
    cursorState !== undefined && leaves.includes(cursorState)
      ? cursorState
      : (override?.requested.find((leaf) => leaves.includes(leaf)) ??
        leaves.find((leaf) => active.has(leaf)) ??
        leaves[0]);

  const bodyRef = React.useRef<HTMLDivElement>(null);
  // Switching machines from the keyboard replaces the focused leaf; focus goes to the new tree rather than the page.
  const refocusTree = React.useRef(false);
  useIsomorphicLayoutEffect(() => {
    if (!refocusTree.current) return;
    refocusTree.current = false;
    const stop = bodyRef.current?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]');
    if (stop) stop.focus();
    else (bodyRef.current?.closest('.sv-panel') as HTMLElement | null)?.focus();
  }, [key]);
  const [status, setStatus] = React.useState('');
  React.useEffect(() => {
    if (status === '') return;
    const timer = setTimeout(() => setStatus(''), 2000);
    return () => clearTimeout(timer);
  }, [status]);

  function preview(leaf: string): void {
    if (!canPreview || key === undefined) return;
    const next = toggleLeaf(override?.requested, leaf);
    if (next.length === 0) registry.release(key);
    else registry.preview(key, { leaves: next });
  }

  function selectLeaf(leaf: string): void {
    setCursor(leaf);
    preview(leaf);
  }

  function moveCursor(to: Move): void {
    if (leaves.length === 0) return;
    const index = cursor === undefined ? -1 : leaves.indexOf(cursor);
    const target =
      to === 'first'
        ? 0
        : to === 'last'
          ? leaves.length - 1
          : to === 'next'
            ? Math.min(index + 1, leaves.length - 1)
            : Math.max(index - 1, 0);
    const leaf = leaves[target];
    setCursor(leaf);
    // Focus follows at once, before React re-renders the roving tab stop.
    const items = bodyRef.current?.querySelectorAll<HTMLElement>('[data-leaf]') ?? [];
    for (const item of items) {
      if (item.dataset.leaf === leaf) {
        item.focus();
        item.scrollIntoView?.({ block: 'nearest' });
      }
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (isTyping(target)) return;
    // Form controls and buttons keep their own keys: arrows change a select or radio, Enter clicks a button.
    const control = target.closest('select, input, textarea');
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End':
        if (control) return;
        event.preventDefault();
        moveCursor(MOVES[event.key]);
        return;
      case 'Enter':
        if (control || target.closest('button, a, summary')) return;
        if (cursor === undefined) return;
        event.preventDefault();
        preview(cursor);
        return;
      case 'Escape':
        event.preventDefault();
        registry.release();
        return;
      case '[':
      case ']':
        if (control) return;
        event.preventDefault();
        refocusTree.current = target.closest('[role="tree"]') !== null;
        props.onCycleMachine(event.key === ']' ? 1 : -1);
        return;
    }
  }

  const plan = planLink(snapshot.machines, snapshot.overrides, key);
  const labelOf = (instanceKey: string) => findInstance(groups, instanceKey)?.label ?? instanceKey;

  async function copyLink(): Promise<void> {
    const { location } = window;
    const search = writeDeepLink(location.search, plan.targets, props.urlParam);
    const url = `${location.href.split(/[?#]/)[0]}${search}${location.hash}`;
    setStatus((await copyText(url, bodyRef.current ?? document.body)) ? 'Link copied' : 'Copy failed');
  }

  async function copyJson(): Promise<void> {
    if (!handle || !instance) return;
    const json = toJson({
      machine: handle.machineId,
      instance: instance.label,
      leaves: override ? override.leaves : [...active],
      preview: override ? { requested: override.requested, source: override.source } : null,
      context: override ? override.context : liveContext,
    });
    setStatus((await copyText(json, bodyRef.current ?? document.body)) ? 'JSON copied' : 'Copy failed');
  }

  const available: Record<DataSource, boolean> = {
    recorded: override?.requested.some((leaf) => data.recorded.has(leaf)) ?? false,
    fixture: override?.leaves.some((leaf) => data.fixture.has(leaf)) ?? false,
    live: true,
  };

  const parent = handle?.parentKey === undefined ? undefined : findInstance(groups, handle.parentKey);
  const children = key === undefined ? [] : childrenOf(groups, key);

  return (
    <section
      ref={props.panelRef}
      id={props.id}
      className="sv-panel"
      aria-label="State viewer"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <header className="sv-header">
        <div className="sv-titlebar">
          <h2 className="sv-title">
            State viewer
            {previewCount > 0 && <span className="sv-title-count">{previewCount} previewing</span>}
          </h2>
          <button
            type="button"
            className="sv-button"
            onClick={() => registry.release()}
            disabled={previewCount === 0}
            title="Release every preview (Esc)"
          >
            Release all
          </button>
          <button
            type="button"
            className="sv-icon-button"
            onClick={props.onMove}
            aria-label="Move to the next corner"
            title="Move to the next corner"
          >
            <CornerIcon />
          </button>
          <button
            type="button"
            className="sv-icon-button"
            onClick={props.onClose}
            aria-label="Close"
            title={props.shortcutLabel ? `Close (${props.shortcutLabel})` : 'Close'}
          >
            <CloseIcon />
          </button>
        </div>
        {group && instance && (
          <div className="sv-pickers">
            <span className="sv-select-wrap">
              <select
                className="sv-select"
                aria-label="Machine"
                title="Machine ([ and ] switch)"
                value={group.machineId}
                onChange={(event) => props.onSelectMachine(event.target.value)}
              >
                {groups.map((candidate) => (
                  <option key={candidate.machineId} value={candidate.machineId}>
                    {machineOption(candidate, snapshot)}
                  </option>
                ))}
              </select>
            </span>
            <span className="sv-select-wrap">
              <select
                className="sv-select"
                aria-label="Instance"
                value={instance.key}
                disabled={group.instances.length < 2}
                onChange={(event) => props.onSelectInstance(event.target.value)}
              >
                {group.instances.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.label}
                    {snapshot.overrides[entry.key] ? ' ●' : ''}
                  </option>
                ))}
              </select>
            </span>
          </div>
        )}
      </header>

      <div className="sv-body" ref={bodyRef}>
        {!handle || !instance ? (
          <p className="sv-empty">
            No machines yet. Hooks from <code>state-viewer/xstate</code> register their actors as they mount, and{' '}
            <code>connect()</code> registers actors created outside React.
          </p>
        ) : (
          <>
            <StatesSection
              instance={instance}
              nodes={nodes}
              active={active}
              cursor={cursor}
              canPreview={canPreview}
              parentLabel={parent?.label}
              childInstances={children}
              onRelease={override && key !== undefined ? () => registry.release(key) : undefined}
              onSelectLeaf={selectLeaf}
              onSelectInstance={props.onSelectInstance}
              snapshot={snapshot}
              data={data}
            />
            <ContextView
              context={override ? override.context : liveContext}
              override={override}
              available={available}
              onSource={(source) => {
                if (override && key !== undefined) registry.preview(key, { leaves: [...override.requested], source });
              }}
            />
            <EventLog entries={snapshot.log} labelOf={labelOf} onClear={() => registry.clearLog()} />
          </>
        )}
      </div>

      <footer className="sv-footer">
        <button
          type="button"
          className="sv-button"
          onClick={copyLink}
          disabled={plan.targets.length === 0}
          title={plan.targets.length === 0 ? 'Preview a state to link to it' : 'Copy a link that opens these previews'}
        >
          Copy link
        </button>
        <button type="button" className="sv-button" onClick={copyJson} disabled={!handle}>
          Copy JSON
        </button>
        <span className="sv-status" role="status">
          {status}
        </span>
        {plan.partial.length > 0 && (
          <p className="sv-warning">
            Links preview every instance of a machine alike, so this one won&rsquo;t reproduce the current{' '}
            {list(plan.partial)} previews exactly.
          </p>
        )}
      </footer>
    </section>
  );
}

interface StatesSectionProps {
  instance: InstanceEntry;
  nodes: readonly StateNodeInfo[];
  active: ReadonlySet<string>;
  cursor: string | undefined;
  canPreview: boolean;
  parentLabel: string | undefined;
  childInstances: InstanceEntry[];
  snapshot: RegistrySnapshot;
  data: DataAvailability;
  onRelease: (() => void) | undefined;
  onSelectLeaf(leaf: string): void;
  onSelectInstance(instanceKey: string): void;
}

function StatesSection(props: StatesSectionProps) {
  const titleId = React.useId();
  const { instance, canPreview, parentLabel, childInstances } = props;
  return (
    <section className="sv-section" aria-labelledby={titleId}>
      <div className="sv-section-head">
        <h3 className="sv-section-title" id={titleId}>
          States
        </h3>
        {props.onRelease && (
          <button type="button" className="sv-button" onClick={props.onRelease}>
            Release
          </button>
        )}
      </div>
      {!canPreview && (
        <p className="sv-hint">
          {parentLabel ? `Child of ${parentLabel}. ` : ''}Child machines are listed read-only.
        </p>
      )}
      {props.nodes.length === 0 ? (
        <p className="sv-hint">This machine has no states to list.</p>
      ) : (
        <StateTree
          nodes={props.nodes}
          label={`States of ${instance.label}`}
          active={props.active}
          override={props.snapshot.overrides[instance.key]}
          data={props.data}
          cursor={props.cursor}
          readOnly={!canPreview}
          onSelect={props.onSelectLeaf}
        />
      )}
      <div className="sv-legend" aria-hidden="true">
        <span>
          <span className="sv-live" data-on="" /> live
        </span>
        <span>
          <DataMark kind="recorded" /> recorded
        </span>
        <span>
          <DataMark kind="fixture" /> fixture
        </span>
        <span>
          <DataMark kind="none" /> no data
        </span>
      </div>
      {childInstances.length > 0 && (
        <div className="sv-children">
          <span className="sv-hint">Children:</span>
          {childInstances.map((child) => (
            <button
              key={child.key}
              type="button"
              className="sv-button"
              onClick={() => props.onSelectInstance(child.key)}
            >
              {child.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function childrenOf(groups: readonly MachineGroup[], parentKey: string): InstanceEntry[] {
  return groups.flatMap((group) => group.instances.filter((entry) => entry.handle.parentKey === parentKey));
}

function machineOption(group: MachineGroup, snapshot: RegistrySnapshot): string {
  const count = group.instances.length > 1 ? ` (${group.instances.length})` : '';
  const previewing = group.instances.some((entry) => snapshot.overrides[entry.key]) ? ' ●' : '';
  return `${group.machineId}${group.child ? ' (child)' : ''}${count}${previewing}`;
}

function list(items: readonly string[]): string {
  const quoted = items.map((item) => `“${item}”`);
  return quoted.length < 2 ? quoted.join('') : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/** What a handle method returns, or `fallback` when the adapter throws: the panel must keep rendering. */
function attempt<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}
