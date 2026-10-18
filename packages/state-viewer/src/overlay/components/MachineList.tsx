// The machine list: a row for each machine on the page, then Release all and Settings.
// The arrows, Home and End move focus through the rows.

import type * as React from 'react';
import { leavesOf } from '../../core/registry';
import type { RegistrySnapshot } from '../../core/types';
import { usePathname } from '../hooks';
import { attempt, type MachineGroup } from '../model';
import { moveIndex, moveOf } from '../shortcut';
import { GearIcon } from './icons';

interface MachineListProps {
  groups: readonly MachineGroup[];
  snapshot: RegistrySnapshot;
  onOpen(machineId: string): void;
  onReleaseAll(): void;
  onSettings(): void;
}

export function MachineList({ groups, snapshot, onOpen, onReleaseAll, onSettings }: MachineListProps) {
  const previewCount = Object.keys(snapshot.overrides).length;

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const move = moveOf(event.key);
    if (!move) return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-row]')];
    event.preventDefault();
    rows[moveIndex(rows.indexOf(event.target as HTMLElement), rows.length, move)]?.focus();
  }

  return (
    <div className="sv-list" onKeyDown={onKeyDown}>
      {groups.length === 0 ? (
        <p className="sv-empty" data-part="empty">
          No machines yet. Hooks from <code>state-viewer/xstate</code> register their actors as they mount, and{' '}
          <code>connect()</code> registers actors created outside React.
        </p>
      ) : (
        <div className="sv-rows">
          {groups.map((group) => (
            <MachineRow
              key={group.machineId}
              group={group}
              previewing={group.instances.some((entry) => snapshot.overrides[entry.key])}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
      <div className="sv-actions">
        {previewCount > 0 && (
          <button
            type="button"
            className="sv-row sv-action"
            data-row="release"
            onClick={onReleaseAll}
            title="Release every preview (Esc)"
          >
            <span className="sv-row-label" data-part="row-label">Release all</span>
            <span className="sv-chip" data-part="chip">{previewCount}</span>
          </button>
        )}
        <button type="button" className="sv-row sv-action" data-row="settings" onClick={onSettings}>
          <span className="sv-row-label" data-part="row-label">Settings</span>
          <GearIcon />
        </button>
      </div>
    </div>
  );
}

function MachineRow({ group, previewing, onOpen }: { group: MachineGroup; previewing: boolean; onOpen(id: string): void }) {
  const states = attempt(() => leavesOf(group.instances[0].handle.describe()).length, 0);
  const instances = group.instances.length;
  return (
    <button
      type="button"
      className="sv-row"
      data-row="machine"
      data-machine={group.machineId}
      onClick={() => onOpen(group.machineId)}
    >
      <span className="sv-row-name" data-part="row-name">{group.machineId}</span>
      {group.childrenOnly && <span className="sv-tag" data-part="tag">child</span>}
      {instances > 1 && (
        <span className="sv-chip" data-part="chip" title={`${instances} instances`}>
          {instances}
        </span>
      )}
      {previewing && (
        <span className="sv-dot" data-part="dot" title="Previewing">
          <span className="sv-visually-hidden">, previewing</span>
        </span>
      )}
      <span className="sv-row-end" data-part="row-end">{states === 1 ? '1 state' : `${states} states`}</span>
    </button>
  );
}

/** The page's path, in a code chip. It renders nothing on the server. */
export function PathChip() {
  const pathname = usePathname();
  if (pathname === '') return null;
  return (
    <code className="sv-chip sv-code" data-part="chip" title={pathname}>
      {pathname}
    </code>
  );
}
