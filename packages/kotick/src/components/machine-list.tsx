import type { KeyboardEvent } from 'react';
import { leavesOf } from '../core/registry';
import { usePathname } from '../hooks/use-pathname';
import type { RegistrySnapshot } from '../types';
import { attempt, type MachineGroup } from '../utils/model';
import { moveIndex, moveOf } from '../utils/shortcut';
import { ACTION, CHIP, FOOTER, ROW, TAG } from './classes';
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

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.defaultPrevented) return;
    const move = moveOf(event);

    if (!move) return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-row]')];
    event.preventDefault();
    const index = rows.findIndex((row) => row === event.target);
    rows[moveIndex(index, rows.length, move)]?.focus();
  }

  return (
    <div className="flex min-h-0 flex-col" onKeyDown={onKeyDown}>
      {groups.length === 0 ? (
        <p className="px-3 py-4 text-center leading-relaxed text-muted" data-part="empty">
          No machines yet. Hooks from <code>kotick/xstate</code> and <code>kotick/reducer</code> register their machines
          as they mount, and <code>connect()</code> registers XState actors created outside React.
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
      <div className={FOOTER}>
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
      className={ROW}
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

export function PathChip() {
  const pathname = usePathname();

  if (pathname === '') return null;

  return (
    <code
      className="inline-block h-4 min-w-4 flex-initial truncate rounded-sm bg-chip px-1 text-center font-mono text-sm leading-4 font-normal text-fg tabular-nums"
      data-part="chip"
      title={pathname}
    >
      {pathname}
    </code>
  );
}
