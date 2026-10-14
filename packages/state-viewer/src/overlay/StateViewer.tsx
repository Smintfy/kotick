// <StateViewer /> in development builds (spec §8.1, §10.6): applies the page's deep link, registers fixtures, and
// renders the toolbar and panel into a shadow root.

import * as React from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_URL_PARAM, readDeepLink } from '../core/deep-link';
import { getRegistry } from '../core/registry';
import type { FixtureSet, Registry } from '../core/types';
import { loadFixtures } from './fixtures';
import { useIsomorphicLayoutEffect, useLatest, useRegistrySnapshot } from './hooks';
import { createHost, type OverlayHost } from './host';
import { LogoIcon } from './icons';
import { findInstance, groupMachines } from './model';
import { Panel } from './Panel';
import { isPosition, nextPosition, readSettings, resolvePosition, writeSettings, type Settings } from './settings';
import { eventOrigin, isTyping, matchesShortcut, parseShortcut } from './shortcut';
import type { FixturesInput, StateViewerProps, Theme } from './types';

const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

export function StateViewer(props: StateViewerProps): React.ReactNode {
  const registry = getRegistry();
  useDeepLink(registry, urlParamOf(props));
  useFixtures(registry, props.fixtures);
  const host = useHost(props.portalTarget);
  return host && createPortal(<Overlay {...props} registry={registry} host={host} />, host.container);
}

// Links applied per registry, so remounting the overlay (Fast Refresh of the component that renders it, a route
// change) doesn't bring back previews the user released.
const appliedLinks = new WeakMap<Registry, Set<string>>();

/**
 * Applies the URL's deep link (R27). In an insertion effect, which React runs before every layout effect of the
 * commit: the app's hooks register in layout effects, so instances that mount along with the overlay are previewed
 * as they register and show the preview in their first paint (§10.2). Earlier ones, like a connect()ed module-level
 * actor, are previewed at the registry's next microtask.
 */
function useDeepLink(registry: Registry, param: string): void {
  React.useInsertionEffect(() => {
    const search = window.location.search;
    let applied = appliedLinks.get(registry);
    if (!applied) {
      applied = new Set();
      appliedLinks.set(registry, applied);
    }
    const id = `${param}\n${search}`;
    if (applied.has(id)) return;
    applied.add(id);
    const targets = readDeepLink(search, param);
    if (targets.length > 0) registry.link(targets);
  }, [registry, param]);
}

// Sets already registered, so a loader that runs again (an inline arrow on a re-render, StrictMode) adds nothing new.
const registeredSets = new WeakMap<Registry, WeakSet<FixtureSet>>();

/** Registers fixtures given directly or by a lazy loader (R18). Previews made before they load pick them up (R16). */
function useFixtures(registry: Registry, input: FixturesInput | undefined): void {
  React.useEffect(() => {
    if (input === undefined) return;
    let current = true;
    void loadFixtures(input).then((sets) => {
      // A newer input took over; its sets win.
      if (!current) return;
      let seen = registeredSets.get(registry);
      if (!seen) {
        seen = new WeakSet();
        registeredSets.set(registry, seen);
      }
      const fresh = sets.filter((set) => !seen.has(set));
      if (fresh.length === 0) return;
      for (const set of fresh) seen.add(set);
      registry.registerFixtures(fresh);
    });
    return () => {
      current = false;
    };
  }, [registry, input]);
}

/** The host element, appended to `target` or `document.body` on the client (R20). Nothing renders on the server. */
function useHost(target: Element | ShadowRoot | undefined): OverlayHost | null {
  const [host, setHost] = React.useState<OverlayHost | null>(null);
  useIsomorphicLayoutEffect(() => {
    const created = createHost(target ?? document.body ?? document.documentElement);
    setHost(created);
    return () => {
      created.remove();
      setHost((current) => (current === created ? null : current));
    };
  }, [target]);
  return host;
}

interface OverlayProps extends StateViewerProps {
  registry: Registry;
  host: OverlayHost;
}

function Overlay(props: OverlayProps) {
  const { registry, host } = props;
  const defaultPosition = isPosition(props.position) ? props.position : 'bottom-right';
  const theme = THEMES.includes(props.theme as Theme) ? (props.theme as Theme) : 'system';
  const urlParam = urlParamOf(props);
  const shortcut = useShortcut(props.shortcut);
  const snapshot = useRegistrySnapshot(registry);
  const panelId = React.useId();

  // R24: read once, written only when the user changes something.
  const [settings, setSettings] = React.useState(readSettings);
  const initialSettings = React.useRef(settings);
  React.useEffect(() => {
    if (settings !== initialSettings.current) writeSettings(settings);
  }, [settings]);
  const update = (patch: Settings) => setSettings((current) => ({ ...current, ...patch }));

  const open = settings.open ?? props.defaultOpen === true;
  const position = resolvePosition(settings, defaultPosition);

  const groups = React.useMemo(() => groupMachines(snapshot.machines), [snapshot.machines]);
  const [instanceKey, setInstanceKey] = React.useState<string>();
  // The stored machine once it registers; until then the first one, without overwriting the stored choice.
  const group =
    groups.find((candidate) => candidate.machineId === settings.machine) ??
    groups.find((candidate) => !candidate.child) ??
    groups[0];
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

  // Focus: opening by hand moves it into the panel, so the panel's keys work at once; closing gives it back to where
  // the shortcut was pressed, or to the bubble, rather than losing it with the panel.
  const panelRef = React.useRef<HTMLElement>(null);
  const bubbleRef = React.useRef<HTMLButtonElement>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);
  const focusOnOpen = React.useRef(false);

  function setOpen(next: boolean, from: 'bubble' | 'shortcut' | 'close'): void {
    if (next === open) return;
    if (next) {
      const active = document.activeElement;
      const outside = active instanceof HTMLElement && active !== host.host;
      returnFocus.current = from === 'shortcut' && outside ? active : null;
      focusOnOpen.current = true;
    } else if (panelRef.current?.contains(host.shadow.activeElement)) {
      const back = returnFocus.current;
      if (back?.isConnected) back.focus();
      else bubbleRef.current?.focus();
    }
    if (!next) returnFocus.current = null;
    update({ open: next });
  }

  useIsomorphicLayoutEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    const panel = panelRef.current;
    const item = panel?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]');
    (item ?? panel)?.focus();
  }, [open]);

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
        data-previewing={previewCount > 0 || undefined}
        onClick={() => setOpen(!open, 'bubble')}
      >
        <LogoIcon />
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

function urlParamOf({ urlParam }: StateViewerProps): string {
  return typeof urlParam === 'string' && urlParam !== '' ? urlParam : DEFAULT_URL_PARAM;
}

/** The parsed toggle shortcut, `undefined` when it's turned off or invalid (with a warning). */
function useShortcut(value: string | false | undefined) {
  const source = value === undefined ? 'alt+s' : value;
  return React.useMemo(() => {
    if (source === false) return undefined;
    const parsed = parseShortcut(source);
    if (!parsed) {
      console.warn(`[state-viewer] Ignoring the shortcut "${String(source)}": expected something like "alt+s".`);
      return undefined;
    }
    const label = source
      .split('+')
      .map((part) => (part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
      .join('+');
    return { parsed, label };
  }, [source]);
}
