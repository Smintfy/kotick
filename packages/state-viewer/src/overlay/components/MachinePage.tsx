// A machine's page: the instance picker, the state tree, context, the event log, and a footer to copy a link or
// the state as JSON. It handles the keys that move through the tree and switch machines.

import * as React from 'react';
import type { DataAvailability, DataSource, Registry, RegistrySnapshot, StateNodeInfo } from '../../core/types';
import { copyText } from '../clipboard';
import { writeDeepLink } from '../deep-link';
import { toJson } from '../format';
import { useHandleUpdates } from '../hooks';
import {
  attempt,
  findInstance,
  planLink,
  shownLeaves,
  toggleLeaf,
  type InstanceEntry,
  type MachineGroup,
} from '../model';
import { isTyping, moveIndex, moveOf, type Move } from '../shortcut';
import { ContextView } from './ContextView';
import { EventLog } from './EventLog';
import { CopyIcon, LinkIcon } from './icons';
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
  urlParam: string;
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
  // What the last copy did. The clicked button shows it in place of its label for 2 s.
  const [copied, setCopied] = React.useState<{ button: 'json' | 'link'; status: string }>();
  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(undefined), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

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
    const target = event.target as HTMLElement;
    if (isTyping(target)) return;
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

  const plan = planLink(snapshot.machines, snapshot.overrides, key);
  const labelOf = (instanceKey: string) => findInstance(groups, instanceKey)?.label ?? instanceKey;

  async function copyLink(): Promise<void> {
    const { location } = window;
    const search = writeDeepLink(location.search, plan.targets, props.urlParam);
    const url = `${location.href.split(/[?#]/)[0]}${search}${location.hash}`;
    const status = (await copyText(url, pageRef.current ?? document.body)) ? 'Link copied' : 'Copy failed';
    setCopied({ button: 'link', status });
  }

  async function copyJson(): Promise<void> {
    const json = toJson({
      machine: handle.machineId,
      instance: instance.label,
      leaves: override ? override.leaves : [...active],
      preview: override ? { requested: override.requested, source: override.source } : null,
      context: override ? override.context : liveContext,
    });
    const status = (await copyText(json, pageRef.current ?? document.body)) ? 'JSON copied' : 'Copy failed';
    setCopied({ button: 'json', status });
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
    <div className="sv-page" ref={pageRef} data-instance={key} tabIndex={-1} onKeyDown={onKeyDown}>
      {group.instances.length > 1 ? (
        <div className="sv-instance">
          <span className="sv-select-wrap">
            <select
              className="sv-select"
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
        handle.label !== undefined && <p className="sv-instance sv-instance-label">{instance.label}</p>
      )}

      <div className="sv-body">
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

      <footer className="sv-footer">
        {/* The names stay the same while a label shows the status, so voice control and tests still find them. */}
        <div className="sv-copy">
          <button type="button" className="sv-footer-button" onClick={copyJson} aria-label="Copy JSON">
            <span>{copied?.button === 'json' ? copied.status : 'Copy JSON'}</span>
            <CopyIcon />
          </button>
          <button
            type="button"
            className="sv-footer-button"
            onClick={copyLink}
            disabled={plan.targets.length === 0}
            aria-label="Copy link"
            title={plan.targets.length === 0 ? 'Preview a state to link to it' : 'Copy a link that opens these previews'}
          >
            <span>{copied?.button === 'link' ? copied.status : 'Copy link'}</span>
            <LinkIcon />
          </button>
        </div>
        <span className="sv-visually-hidden" role="status">
          {copied?.status}
        </span>
        {plan.partial.length > 0 && (
          <p className="sv-warning" data-part="warning">
            Links preview every instance of a machine alike, so this one won&rsquo;t reproduce the current{' '}
            {list(plan.partial)} previews exactly.
          </p>
        )}
      </footer>
    </div>
  );
}

function childrenOf(groups: readonly MachineGroup[], parentKey: string): InstanceEntry[] {
  return groups.flatMap((group) => group.instances.filter((entry) => entry.handle.parentKey === parentKey));
}

function list(items: readonly string[]): string {
  const quoted = items.map((item) => `“${item}”`);
  return quoted.length < 2 ? quoted.join('') : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}
