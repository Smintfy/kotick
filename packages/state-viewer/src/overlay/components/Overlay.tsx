// The toolbar bubble and the panel it opens, inside the shadow root.
// It keeps the settings, picks the machine to show, moves focus in and out of the panel, and handles the shortcut.

import * as React from 'react';
import type { Registry } from '../../core/types';
import { resolveUrlParam } from '../deep-link';
import { useIsomorphicLayoutEffect, useLatest, useRegistrySnapshot } from '../hooks';
import type { OverlayHost } from '../host';
import { findInstance, groupMachines, type MachineGroup } from '../model';
import type { StateViewerProps, Theme } from '../props';
import { isPosition, nextPosition, readSettings, resolvePosition, writeSettings, type Settings } from '../settings';
import { eventOrigin, isTyping, matchesShortcut, parseShortcut } from '../shortcut';
import { HexagonIcon } from './icons';
import { Panel } from './Panel';

const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

interface OverlayProps extends StateViewerProps {
  registry: Registry;
  host: OverlayHost;
}

export function Overlay(props: OverlayProps) {
  const { registry, host } = props;
  const defaultPosition = isPosition(props.position) ? props.position : 'bottom-right';
  const theme = THEMES.includes(props.theme as Theme) ? (props.theme as Theme) : 'system';
  const urlParam = resolveUrlParam(props.urlParam);
  const shortcut = useShortcut(props.shortcut);
  const snapshot = useRegistrySnapshot(registry);
  const panelId = React.useId();

  const [settings, update] = useStoredSettings();
  const open = settings.open ?? props.defaultOpen === true;
  const position = resolvePosition(settings, defaultPosition);

  const groups = React.useMemo(() => groupMachines(snapshot.machines), [snapshot.machines]);
  const [instanceKey, setInstanceKey] = React.useState<string>();
  const group = groupToShow(groups, settings.machine);
  const instance = group && (group.instances.find((entry) => entry.key === instanceKey) ?? group.instances[0]);

  function selectMachine(machineId: string): void {
    update({ machine: machineId });
    setInstanceKey(undefined);
  }

  function selectInstance(key: string): void {
    const entry = findInstance(groups, key);
    if (!entry) return;
    if (entry.handle.machineId !== group?.machineId) update({ machine: entry.handle.machineId });
    setInstanceKey(key);
  }

  function cycleMachine(step: 1 | -1): void {
    if (groups.length < 2 || !group) return;
    const index = groups.indexOf(group);
    selectMachine(groups[(index + step + groups.length) % groups.length].machineId);
  }

  const { panelRef, bubbleRef, onToggle } = usePanelFocus(open, host);

  function setOpen(next: boolean, from: ToggleOrigin): void {
    if (next === open) return;
    onToggle(next, from);
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

  return (
    <div className="sv-root" data-theme={theme} data-position={position}>
      <button
        ref={bubbleRef}
        type="button"
        className="sv-bubble"
        aria-label={bubbleLabel}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={shortcut ? `State viewer (${shortcut.label})` : 'State viewer'}
        onClick={() => setOpen(!open, 'bubble')}
      >
        <HexagonIcon />
        {previewCount > 0 && (
          <span className="sv-badge" aria-hidden="true">
            {previewCount}
          </span>
        )}
      </button>
      {open && (
        <Panel
          id={panelId}
          registry={registry}
          snapshot={snapshot}
          groups={groups}
          group={group}
          instance={instance}
          urlParam={urlParam}
          shortcutLabel={shortcut?.label}
          panelRef={panelRef}
          onSelectMachine={selectMachine}
          onSelectInstance={selectInstance}
          onCycleMachine={cycleMachine}
          onMove={() => update({ position: nextPosition(position), positionDefault: defaultPosition })}
          onClose={() => setOpen(false, 'close')}
        />
      )}
    </div>
  );
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

/**
 * The stored machine once it registers.
 * Until then, the first machine with an instance that isn't a child machine, or else the first machine.
 * The fallback doesn't replace the stored machine.
 */
function groupToShow(groups: readonly MachineGroup[], storedMachine: string | undefined): MachineGroup | undefined {
  return (
    groups.find((candidate) => candidate.machineId === storedMachine) ??
    groups.find((candidate) => !candidate.childrenOnly) ??
    groups[0]
  );
}

type ToggleOrigin = 'bubble' | 'shortcut' | 'close';

/**
 * Moves focus into the panel when it opens, so the panel's keys work at once.
 * When the panel closes, it gives focus back to where the shortcut was pressed, or to the bubble.
 * Call onToggle() before the panel opens or closes.
 */
function usePanelFocus(open: boolean, host: OverlayHost) {
  const panelRef = React.useRef<HTMLElement>(null);
  const bubbleRef = React.useRef<HTMLButtonElement>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);
  const focusOnOpen = React.useRef(false);

  useIsomorphicLayoutEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    const panel = panelRef.current;
    const item = panel?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]');
    (item ?? panel)?.focus();
  }, [open]);

  function onToggle(next: boolean, from: ToggleOrigin): void {
    if (next) {
      const active = document.activeElement;
      const outside = active instanceof HTMLElement && active !== host.host;
      returnFocus.current = from === 'shortcut' && outside ? active : null;
      focusOnOpen.current = true;
      return;
    }
    if (panelRef.current?.contains(host.shadow.activeElement)) {
      const back = returnFocus.current;
      if (back?.isConnected) back.focus();
      else bubbleRef.current?.focus();
    }
    returnFocus.current = null;
  }

  return { panelRef, bubbleRef, onToggle };
}

// StrictMode and Fast Refresh run the memo again, so each invalid shortcut warns once per page.
const warnedShortcuts = new Set<string>();

function useShortcut(value: string | false | undefined) {
  const source = value === undefined ? 'alt+s' : value;
  return React.useMemo(() => {
    if (source === false) return undefined;
    const parsed = parseShortcut(source);
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
