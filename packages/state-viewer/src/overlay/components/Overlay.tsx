// The toolbar bubble and the panel it opens, inside the shadow root.
// It keeps the settings, picks the page to show, moves focus in and out of the panel and between its pages, and
// handles the shortcut.

import * as React from 'react';
import type { Registry } from '../../core/types';
import { resolveUrlParam } from '../deep-link';
import { useIsomorphicLayoutEffect, useLatest, useRegistrySnapshot } from '../hooks';
import type { OverlayHost } from '../host';
import { findInstance, groupMachines, type MachineGroup, type PanelPage } from '../model';
import type { StateViewerProps, Theme } from '../props';
import { isPosition, readSettings, resolvePosition, writeSettings, type Settings } from '../settings';
import { eventOrigin, isShortcutText, isTyping, matchesShortcut, parseShortcut } from '../shortcut';
import { CHIP } from './classes';
import { HexagonIcon } from './icons';
import { MachineList, PathChip } from './MachineList';
import { MachinePage } from './MachinePage';
import { Panel } from './Panel';
import { SettingsPage } from './SettingsPage';

const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme === value);
}

interface OverlayProps extends StateViewerProps {
  registry: Registry;
  host: OverlayHost;
}

export function Overlay(props: OverlayProps) {
  const { registry, host } = props;
  const defaultPosition = isPosition(props.position) ? props.position : 'bottom-right';
  const theme = isTheme(props.theme) ? props.theme : 'system';
  const urlParam = resolveUrlParam(props.urlParam);
  const shortcut = useShortcut(props.shortcut);
  const snapshot = useRegistrySnapshot(registry);
  const panelId = React.useId();

  const [settings, update] = useStoredSettings();
  const open = settings.open ?? props.defaultOpen === true;
  const position = resolvePosition(settings, defaultPosition);

  const groups = React.useMemo(() => groupMachines(snapshot.machines), [snapshot.machines]);
  const [subpage, setSubpage] = React.useState<'settings'>();
  const [instanceKey, setInstanceKey] = React.useState<string>();
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
  React.useEffect(() => {
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
      ? 'State viewer'
      : `State viewer, ${previewCount} preview${previewCount === 1 ? '' : 's'} active`;

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
              urlParam={urlParam}
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
      data-theme={theme}
      data-position={position}
    >
      <button
        ref={bubbleRef}
        type="button"
        className="pointer-events-auto absolute grid size-8 cursor-pointer place-items-center rounded-lg border border-transparent bg-bubble p-0 text-white [box-shadow:var(--sv-shadow)] [transition:background-color_120ms_ease] hover:bg-bubble-hover in-data-[position$=left]:left-4 in-data-[position$=right]:right-4 in-data-[position^=bottom]:bottom-4 in-data-[position^=top]:top-4 motion-reduce:[transition:none] dark:border-bubble-edge"
        aria-label={bubbleLabel}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={shortcut ? `State viewer (${shortcut.label})` : 'State viewer'}
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

/** What the shell shows for a page: its header, and the page itself. */
interface PageView {
  title: string;
  chips?: React.ReactNode;
  onBack?: () => void;
  body: React.ReactNode;
}

/**
 * The settings page while it is open. Else the stored machine's page once that machine registers, with the picked
 * instance or else its first. Else the machine list.
 */
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

/** The panel settings in localStorage. They are read once, and written only when the user changes something. */
function useStoredSettings() {
  const [settings, setSettings] = React.useState(readSettings);
  const initialSettings = React.useRef(settings);
  React.useEffect(() => {
    if (settings !== initialSettings.current) writeSettings(settings);
  }, [settings]);
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
  const panelRef = React.useRef<HTMLElement>(null);
  const bubbleRef = React.useRef<HTMLButtonElement>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);
  // Set until the next commit, which shows the new page. `from` is the page before it, or undefined on open.
  const moveFocus = React.useRef<{ from: PanelPage | undefined } | null>(null);

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

/**
 * Where focus goes on a page: the tree's tab stop, the checked corner, or a row of the list.
 * Back on the list, it goes to the row of the page it came from.
 */
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

// StrictMode and Fast Refresh run the memo again, so each invalid shortcut warns once per page.
const warnedShortcuts = new Set<string>();

function useShortcut(value: string | false | undefined) {
  const source = value === undefined ? 'alt+s' : value;

  return React.useMemo(() => {
    if (source === false) return undefined;
    const parsed = isShortcutText(source) ? parseShortcut(source) : undefined;

    if (!parsed) {
      if (!warnedShortcuts.has(source)) {
        warnedShortcuts.add(source);
        console.warn(`[state-viewer] Ignoring the shortcut "${String(source)}": expected something like "alt+s".`);
      }

      return undefined;
    }

    const label = source
      .split('+')
      .map((part) => (part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
      .join('+');

    return { parsed, label };
  }, [source]);
}
