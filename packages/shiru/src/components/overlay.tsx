import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { warnOnce } from '../core/warn-once';
import { useLatest } from '../hooks/use-latest';
import { useRegistrySnapshot } from '../hooks/use-registry-snapshot';
import { useIsomorphicLayoutEffect } from '../shared-hooks/use-isomorphic-layout-effect';
import type { ShiruProps, Registry } from '../types';
import type { OverlayHost } from '../utils/host';
import { findInstance, groupMachines, type MachineGroup, type PanelPage } from '../utils/model';
import { isPosition, resolvePosition, type Settings, type SettingsStore } from '../utils/settings';
import { eventOrigin, formatShortcut, isShortcutText, isTyping, matchesShortcut, parseShortcut } from '../utils/shortcut';
import { CHIP } from './classes';
import { HexagonIcon } from './icons';
import { MachineList, PathChip } from './machine-list';
import { MachinePage } from './machine-page';
import { Panel } from './panel';
import { SettingsPage } from './settings-page';

interface OverlayProps extends ShiruProps {
  registry: Registry;
  host: OverlayHost;
  settings: SettingsStore;
  /** Opens the panel on this page instead of the machine list or the stored machine. */
  defaultSubpage?: 'settings';
}

export function Overlay(props: OverlayProps) {
  const { registry, host } = props;
  const defaultPosition = isPosition(props.position) ? props.position : 'bottom-right';
  const shortcut = useShortcut(props.shortcut);
  const snapshot = useRegistrySnapshot(registry);
  const panelId = useId();

  const [settings, update] = useStoredSettings(props.settings);
  const open = settings.open ?? props.defaultOpen === true;
  const position = resolvePosition(settings, defaultPosition);

  const groups = useMemo(() => groupMachines(snapshot.machines), [snapshot.machines]);
  const [subpage, setSubpage] = useState(props.defaultSubpage);
  const [instanceKey, setInstanceKey] = useState<string>();
  const page = pageToShow(subpage, groups, settings.machine, instanceKey);

  const { panelRef, bubbleRef, onToggle, focusWithPage } = usePanelFocus(open, host, page);

  function openMachine(machineId: string): void {
    focusWithPage();
    update({ machine: machineId });
    setInstanceKey(undefined);
  }

  function back(): void {
    focusWithPage();
    setSubpage(undefined);
    update({ machine: undefined });
  }

  function openSettings(): void {
    focusWithPage();
    setSubpage('settings');
  }

  function pickInstance(key: string): void {
    const entry = findInstance(groups, key);

    if (!entry) return;

    if (entry.handle.machineId !== settings.machine) update({ machine: entry.handle.machineId });
    setInstanceKey(key);
  }

  // Unlike the Instance picker, a Children button doesn't stay on the page, so focus follows to the child's tree.
  function openInstance(key: string): void {
    focusWithPage();
    pickInstance(key);
  }

  function cycleMachine(step: 1 | -1): void {
    if (page.kind !== 'machine' || groups.length < 2) return;
    const index = groups.indexOf(page.group);
    openMachine(groups[(index + step + groups.length) % groups.length].machineId);
  }

  function setOpen(next: boolean, from: ToggleOrigin): void {
    if (next === open) return;
    onToggle(next, from);

    if (!next) setSubpage(undefined);
    update({ open: next });
  }

  const toggle = useLatest(() => setOpen(!open, 'shortcut'));
  useEffect(() => {
    if (!shortcut) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;

      if (!matchesShortcut(shortcut.parsed, event) || isTyping(eventOrigin(event))) return;
      event.preventDefault();
      toggle.current();
    };

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcut, toggle]);

  const previewCount = Object.keys(snapshot.overrides).length;

  const bubbleLabel =
    previewCount === 0
      ? 'Shiru'
      : `Shiru, ${previewCount} preview${previewCount === 1 ? '' : 's'} active`;

  function pageView(): PageView {
    switch (page.kind) {
      case 'machines':
        return {
          title: 'Machines',
          chips: (
            <>
              <PathChip />
              {groups.length > 0 && (
                <span className={CHIP} data-part="chip">
                  {groups.length}
                </span>
              )}
            </>
          ),
          body: (
            <MachineList
              groups={groups}
              snapshot={snapshot}
              onOpen={openMachine}
              onReleaseAll={() => registry.release()}
              onSettings={openSettings}
            />
          ),
        };
      case 'settings':
        return {
          title: 'Settings',
          onBack: back,
          body: (
            <SettingsPage
              position={position}
              shortcutLabel={shortcut?.label}
              onPosition={(next) => update({ position: next, positionDefault: defaultPosition })}
            />
          ),
        };
      case 'machine': {
        const requested = snapshot.overrides[page.instance.key]?.requested.length ?? 0;

        return {
          title: page.group.machineId,
          chips: requested > 0 && (
            <span className={CHIP} data-part="chip" title={`${requested} previewed state${requested === 1 ? '' : 's'}`}>
              {requested}
            </span>
          ),
          onBack: back,
          body: (
            <MachinePage
              registry={registry}
              snapshot={snapshot}
              groups={groups}
              group={page.group}
              instance={page.instance}
              onPickInstance={pickInstance}
              onOpenInstance={openInstance}
              onCycleMachine={cycleMachine}
            />
          ),
        };
      }
    }
  }

  const view = open ? pageView() : undefined;

  return (
    // "all" on the host leaves direction alone, so the root sets it, or the page's would be inherited.
    <div
      className="pointer-events-none absolute inset-0 text-left font-sans text-base leading-normal font-normal text-fg [direction:ltr] [-webkit-font-smoothing:antialiased]"
      data-position={position}
    >
      <button
        ref={bubbleRef}
        type="button"
        className="pointer-events-auto absolute grid size-8 cursor-pointer place-items-center rounded-lg border border-bubble-edge bg-bubble p-0 text-white [transition:background-color_120ms_ease] hover:bg-bubble-hover in-data-[position$=left]:left-4 in-data-[position$=right]:right-4 in-data-[position^=bottom]:bottom-4 in-data-[position^=top]:top-4 motion-reduce:[transition:none]"
        aria-label={bubbleLabel}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={shortcut ? `Shiru (${shortcut.label})` : 'Shiru'}
        onClick={() => setOpen(!open, 'bubble')}
      >
        <HexagonIcon />
        {previewCount > 0 && (
          <span
            className="absolute -top-1.5 -right-1.5 h-4.5 min-w-4.5 rounded-[9px] border-2 border-bg bg-badge px-1.25 text-center text-xs leading-3.5 font-bold text-white tabular-nums"
            data-part="badge"
            aria-hidden="true"
          >
            {previewCount}
          </span>
        )}
      </button>
      {view && (
        <Panel
          id={panelId}
          panelRef={panelRef}
          page={page.kind}
          title={view.title}
          chips={view.chips}
          onBack={view.onBack}
          shortcutLabel={shortcut?.label}
          onClose={() => setOpen(false, 'close')}
          onReleaseAll={() => registry.release()}
        >
          {view.body}
        </Panel>
      )}
    </div>
  );
}

interface PageView {
  title: string;
  chips?: ReactNode;
  onBack?: () => void;
  body: ReactNode;
}

function pageToShow(
  subpage: 'settings' | undefined,
  groups: readonly MachineGroup[],
  storedMachine: string | undefined,
  instanceKey: string | undefined,
): PanelPage {
  if (subpage === 'settings') return { kind: 'settings' };
  const group = groups.find((candidate) => candidate.machineId === storedMachine);

  if (!group) return { kind: 'machines' };
  const instance = group.instances.find((entry) => entry.key === instanceKey) ?? group.instances[0];

  return { kind: 'machine', group, instance };
}

/** The panel settings. They are read once, and written only when the user changes something. */
function useStoredSettings(store: SettingsStore) {
  const [settings, setSettings] = useState(() => store.read());
  const initialSettings = useRef(settings);
  useEffect(() => {
    if (settings !== initialSettings.current) store.write(settings);
  }, [settings, store]);
  const update = (patch: Settings) => setSettings((current) => ({ ...current, ...patch }));

  return [settings, update] as const;
}

type ToggleOrigin = 'bubble' | 'shortcut' | 'close';

/**
 * Moves focus into the panel when it opens, so the panel's keys work at once.
 * When the panel closes, it gives focus back to where the shortcut was pressed, or to the bubble.
 * When a click or a key in the panel goes to another page, focus goes into the new page.
 * Call onToggle() before the panel opens or closes, and focusWithPage() before the page changes.
 */
function usePanelFocus(open: boolean, host: OverlayHost, page: PanelPage) {
  const panelRef = useRef<HTMLElement>(null);
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  // Set until the next commit, which shows the new page. `from` is the page before it, or undefined on open.
  const moveFocus = useRef<{ from: PanelPage | undefined } | null>(null);

  useIsomorphicLayoutEffect(() => {
    const request = moveFocus.current;
    moveFocus.current = null;
    const panel = panelRef.current;

    if (request && open && panel) focusTarget(panel, page, request.from).focus();
  });

  function onToggle(next: boolean, from: ToggleOrigin): void {
    if (next) {
      const active = document.activeElement;
      const outside = active instanceof HTMLElement && active !== host.host;
      returnFocus.current = from === 'shortcut' && outside ? active : null;
      moveFocus.current = { from: undefined };

      return;
    }

    if (panelRef.current?.contains(host.shadow.activeElement)) {
      const back = returnFocus.current;

      if (back?.isConnected) back.focus();
      else bubbleRef.current?.focus();
    }

    returnFocus.current = null;
  }

  // Only when focus is in the panel: a page that changes on its own, such as when its machine registers, keeps it.
  function focusWithPage(): void {
    if (panelRef.current?.contains(host.shadow.activeElement)) moveFocus.current = { from: page };
  }

  return { panelRef, bubbleRef, onToggle, focusWithPage };
}

function focusTarget(panel: HTMLElement, page: PanelPage, from: PanelPage | undefined): HTMLElement {
  switch (page.kind) {
    case 'machine':
      return (
        panel.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]') ??
        panel.querySelector<HTMLElement>('[data-instance]') ??
        panel
      );
    case 'settings':
      return panel.querySelector<HTMLElement>('[role="radiogroup"] input:checked') ?? panel;
    case 'machines': {
      const rows = [...panel.querySelectorAll<HTMLElement>('[data-row]')];

      const cameFrom =
        from?.kind === 'machine'
          ? rows.find((row) => row.dataset.machine === from.group.machineId)
          : from?.kind === 'settings'
            ? rows.find((row) => row.dataset.row === 'settings')
            : undefined;

      return cameFrom ?? rows[0] ?? panel;
    }
  }
}

function useShortcut(value: string | false | undefined) {
  const source = value === undefined ? 'alt+s' : value;

  return useMemo(() => {
    if (source === false) return undefined;
    const parsed = isShortcutText(source) ? parseShortcut(source) : undefined;

    if (!parsed) {
      warnOnce(
        `shortcut:${String(source)}`,
        `[shiru] Ignoring the shortcut "${String(source)}": expected something like "alt+s".`,
      );

      return undefined;
    }

    return { parsed, label: formatShortcut(parsed) };
  }, [source]);
}
