// A machine's page: the instance picker, the state tree, context, the event log, and the Copy JSON button.
// It handles the keys that move through the tree and switch machines.

import * as React from 'react';
import type { DataAvailability, DataSource, Registry, RegistrySnapshot, StateNodeInfo } from '../../core/types';
import { copyText } from '../clipboard';
import { toJson } from '../format';
import { useHandleUpdates } from '../hooks';
import { attempt, findInstance, shownLeaves, toggleLeaf, type InstanceEntry, type MachineGroup } from '../model';
import { isElement, isTyping, moveIndex, moveOf, type Move } from '../shortcut';
import { ContextView } from './ContextView';
import { EventLog } from './EventLog';
import { BODY } from './classes';
import { CopyIcon } from './icons';
import { StatesSection } from './StatesSection';

const EMPTY_DATA: DataAvailability = { recorded: new Set(), fixture: new Set() };

const NO_NODES: StateNodeInfo[] = [];
const NONE_COLLAPSED: ReadonlySet<string> = new Set();

interface MachinePageProps {
  registry: Registry;
  snapshot: RegistrySnapshot;
  groups: readonly MachineGroup[];
  group: MachineGroup;
  instance: InstanceEntry;
  /** Shows another instance from the Instance picker. */
  onPickInstance(instanceKey: string): void;
  /** Shows another instance from a Children button. */
  onOpenInstance(instanceKey: string): void;
  onCycleMachine(step: 1 | -1): void;
}

export function MachinePage(props: MachinePageProps) {
  const { registry, snapshot, groups, group, instance } = props;
  const { handle, key } = instance;
  useHandleUpdates(handle);

  const override = snapshot.overrides[key];
  const canPreview = handle.capabilities?.preview === true;
  const nodes = React.useMemo(() => attempt(() => handle.describe(), NO_NODES), [handle]);
  // Collapsed groups belong to one showing of an instance.
  // Another instance, or the same one shown again, starts with every group open.
  const [collapse, setCollapse] = React.useState({ key, groups: NONE_COLLAPSED });

  if (collapse.key !== key) setCollapse({ key, groups: NONE_COLLAPSED });
  const collapsed = collapse.groups;
  // The leaves that show: the arrows and the cursor skip the leaves of a collapsed group.
  const leaves = React.useMemo(() => shownLeaves(nodes, collapsed), [nodes, collapsed]);
  // Read on every render: the handle's updates re-render the page, the registry snapshot doesn't change for them.
  const active = new Set<string>(attempt(() => handle.getActiveLeaves(), []));
  const liveContext = attempt(() => handle.getContext(), undefined);
  const data = snapshot.data[handle.machineId] || EMPTY_DATA;

  // The leaf keyboard navigation is on: the one last moved to or clicked, else the previewed, live or first leaf.
  const [cursorState, setCursor] = React.useState<string>();

  const cursor =
    cursorState !== undefined && leaves.includes(cursorState)
      ? cursorState
      : (override?.requested.find((leaf) => leaves.includes(leaf)) ??
        leaves.find((leaf) => active.has(leaf)) ??
        leaves[0]);

  const pageRef = React.useRef<HTMLDivElement>(null);
  // What the last copy did. The button shows it in place of its label for 2 s.
  const [copyStatus, setCopyStatus] = React.useState<string>();
  React.useEffect(() => {
    if (copyStatus === undefined) return;
    const timer = setTimeout(() => setCopyStatus(undefined), 2000);

    return () => clearTimeout(timer);
  }, [copyStatus]);

  function preview(leaf: string): void {
    if (!canPreview) return;
    const toggle = toggleLeaf(override?.requested, leaf);

    if (toggle.action === 'release') registry.release(key);
    else registry.preview(key, { leaves: toggle.leaves });
  }

  function selectLeaf(leaf: string): void {
    setCursor(leaf);
    preview(leaf);
  }

  function toggleGroup(id: string): void {
    const next = new Set(collapsed);

    if (!next.delete(id)) next.add(id);
    setCollapse({ key, groups: next });
  }

  function moveCursor(move: Move): void {
    if (leaves.length === 0) return;
    const leaf = leaves[moveIndex(cursor === undefined ? -1 : leaves.indexOf(cursor), leaves.length, move)];
    setCursor(leaf);
    // Focus follows at once, before React re-renders the roving tab stop.
    const items = pageRef.current?.querySelectorAll<HTMLElement>('[data-leaf]') ?? [];

    for (const item of items) {
      if (item.dataset.leaf === leaf) {
        item.focus();
        item.scrollIntoView?.({ block: 'nearest' });
      }
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const { target } = event;

    if (!isElement(target) || isTyping(target)) return;
    // Form controls and buttons keep their own keys: arrows change a select or radio, Enter clicks a button.
    const control = target.closest('select, input, textarea');
    const move = moveOf(event.key);

    if (move) {
      if (control) return;
      event.preventDefault();
      moveCursor(move);

      return;
    }

    switch (event.key) {
      case 'Enter':
        if (control || target.closest('button, a, summary')) return;

        if (cursor === undefined) return;
        event.preventDefault();
        preview(cursor);

        return;
      case '[':
      case ']':
        if (control) return;
        event.preventDefault();
        props.onCycleMachine(event.key === ']' ? 1 : -1);

        return;
    }
  }

  const labelOf = (instanceKey: string) => findInstance(groups, instanceKey)?.label ?? instanceKey;

  async function copyJson(): Promise<void> {
    const json = toJson({
      machine: handle.machineId,
      instance: instance.label,
      leaves: override ? override.leaves : [...active],
      preview: override ? { requested: override.requested, source: override.source } : null,
      context: override ? override.context : liveContext,
    });

    setCopyStatus((await copyText(json, pageRef.current ?? document.body)) ? 'JSON copied' : 'Copy failed');
  }

  const available: Record<DataSource, boolean> = {
    recorded: override?.requested.some((leaf) => data.recorded.has(leaf)) ?? false,
    fixture: override?.leaves.some((leaf) => data.fixture.has(leaf)) ?? false,
    live: true,
  };

  const parent = handle.parentKey === undefined ? undefined : findInstance(groups, handle.parentKey);
  const children = childrenOf(groups, key);

  return (
    // Focusable, so a click on a blank part of the page keeps its keys working.
    <div
      className="flex min-h-0 flex-auto flex-col focus-visible:[outline:none]"
      ref={pageRef} data-instance={key} tabIndex={-1} onKeyDown={onKeyDown}>
      {group.instances.length > 1 ? (
        <div className="flex-none px-1.5 pt-1.5">
          <span className="relative block min-w-0 after:pointer-events-none after:absolute after:top-1/2 after:right-2.5 after:-mt-1 after:size-1.25 after:transform-[rotate(45deg)] after:border-r-[1.5px] after:border-b-[1.5px] after:border-r-muted after:border-b-muted">
            <select
              className="block h-6.5 w-full cursor-pointer appearance-none rounded-md bg-surface py-0 pr-6 pl-1.5 text-base text-ellipsis text-fg"
              aria-label="Instance"
              value={key}
              onChange={(event) => props.onPickInstance(event.target.value)}
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
      ) : (
        // A label from the app names the instance even when the machine has no other instance to pick.
        handle.label !== undefined && <p className="flex-none truncate px-3 pt-1.5 text-base text-muted">{instance.label}</p>
      )}

      <div className={BODY}>
        <StatesSection
          instance={instance}
          nodes={nodes}
          active={active}
          collapsed={collapsed}
          cursor={cursor}
          canPreview={canPreview}
          parentLabel={parent?.label}
          childInstances={children}
          onRelease={override ? () => registry.release(key) : undefined}
          onSelectLeaf={selectLeaf}
          onToggleGroup={toggleGroup}
          onSelectInstance={props.onOpenInstance}
          snapshot={snapshot}
          data={data}
        />
        <ContextView
          context={override ? override.context : liveContext}
          override={override}
          available={available}
          onSource={(source) => {
            if (override) registry.preview(key, { leaves: [...override.requested], source });
          }}
        />
        <EventLog entries={snapshot.log} labelOf={labelOf} onClear={() => registry.clearLog()} />
      </div>

      <footer className="flex-none border-t border-t-line px-1.5 py-1">
        {/* The name stays the same while the label shows the status, so voice control and tests still find it. */}
        <button
          type="button"
          className="flex h-7.5 w-full cursor-pointer items-center justify-between gap-1.5 rounded-md bg-transparent px-1.5 py-0 text-lg whitespace-nowrap text-fg enabled:hover:bg-hover [&>svg]:flex-none [&>svg]:text-muted"
          onClick={copyJson}
          aria-label="Copy JSON"
        >
          <span className="overflow-hidden text-ellipsis">{copyStatus ?? 'Copy JSON'}</span>
          <CopyIcon />
        </button>
        <span className="visually-hidden" role="status">
          {copyStatus}
        </span>
      </footer>
    </div>
  );
}

function childrenOf(groups: readonly MachineGroup[], parentKey: string): InstanceEntry[] {
  return groups.flatMap((group) => group.instances.filter((entry) => entry.handle.parentKey === parentKey));
}
