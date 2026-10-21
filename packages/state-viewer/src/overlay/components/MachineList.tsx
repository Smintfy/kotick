// The machine list: a row for each machine on the page, then Release all and Settings.
// The arrows, Home and End move focus through the rows.

import type * as React from 'react';
import { leavesOf } from '../../core/registry';
import type { RegistrySnapshot } from '../../core/types';
import { usePathname } from '../hooks';
import { attempt, type MachineGroup } from '../model';
import { moveIndex, moveOf } from '../shortcut';
import { CHIP, TAG } from './classes';
import { GearIcon } from './icons';

const ACTION =
  'flex h-8.5 w-full cursor-pointer items-center gap-1.5 rounded-md bg-transparent px-1.5 py-0 text-left text-lg text-fg hover:bg-hover [&>:last-child]:ml-auto [&>svg]:text-muted';

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
    <div className="flex min-h-0 flex-col" onKeyDown={onKeyDown}>
      {groups.length === 0 ? (
        <p className="px-3 py-4 text-center leading-relaxed text-muted" data-part="empty">
          No machines yet. Hooks from <code>state-viewer/xstate</code> register their actors as they mount, and{' '}
          <code>connect()</code> registers actors created outside React.
        </p>
      ) : (
        <div className="grid gap-0.5 overflow-auto overscroll-contain p-1.5">
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
      <div className="grid flex-none border-t border-t-line px-1.5 py-0.5">
        {previewCount > 0 && (
          <button
            type="button"
            className={ACTION}
            data-row="release"
            onClick={onReleaseAll}
            title="Release every preview (Esc)"
          >
            <span data-part="row-label">Release all</span>
            <span className={CHIP} data-part="chip">
              {previewCount}
            </span>
          </button>
        )}
        <button type="button" className={ACTION} data-row="settings" onClick={onSettings}>
          <span data-part="row-label">Settings</span>
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
      className="flex h-6.5 w-full cursor-pointer items-center gap-1.5 rounded-md bg-transparent px-1.5 py-0 text-left text-fg hover:bg-hover"
      data-row="machine"
      data-machine={group.machineId}
      onClick={() => onOpen(group.machineId)}
    >
      <span className="min-w-0 truncate font-mono text-base" data-part="row-name">{group.machineId}</span>
      {group.childrenOnly && <span className={TAG} data-part="tag">
          child
        </span>}
      {instances > 1 && (
        <span className={CHIP} data-part="chip" title={`${instances} instances`}>
          {instances}
        </span>
      )}
      {previewing && (
        <span className="size-1.5 flex-none rounded-[50%] bg-accent" data-part="dot" title="Previewing">
          <span className="visually-hidden">, previewing</span>
        </span>
      )}
      <span className="ml-auto flex-none pl-2 text-base text-muted" data-part="row-end">{states === 1 ? '1 state' : `${states} states`}</span>
    </button>
  );
}

/** The page's path, in a code chip. It renders nothing on the server. */
export function PathChip() {
  const pathname = usePathname();

  if (pathname === '') return null;

  return (
    <code
      className="inline-block h-4.5 min-w-0 flex-initial truncate rounded-sm bg-chip px-1.25 text-center font-mono text-sm leading-4.5 font-normal text-fg tabular-nums"
      data-part="chip"
      title={pathname}
    >
      {pathname}
    </code>
  );
}
