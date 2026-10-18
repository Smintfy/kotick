// Panel UI state kept in localStorage: whether the panel is open, its corner, and the machine whose page it shows.

import type { Position } from './props';

const SETTINGS_KEY = 'state-viewer:ui';

export interface Settings {
  open?: boolean;
  position?: Position;
  /**
   * The `position` prop the user moved away from. The stored position applies only while the prop stays the same, so
   * an app that changes its default isn't overruled by a choice made against the old one.
   */
  positionDefault?: Position;
  /**
   * The id of the machine whose page the panel shows. Unset shows the machine list.
   * Instance ids change on every page load, so the instance isn't kept.
   */
  machine?: string;
}

const POSITIONS: readonly Position[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

export function isPosition(value: unknown): value is Position {
  return POSITIONS.includes(value as Position);
}

function defaultStorage(): Storage | null {
  try {
    // Throws a SecurityError in sandboxed frames and when site data is blocked.
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The stored settings, leaving out whatever is missing or invalid. */
export function readSettings(): Settings {
  const storage = defaultStorage();
  if (!storage) return {};
  let payload: unknown;
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (raw === null) return {};
    payload = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof payload !== 'object' || payload === null || (payload as { v?: unknown }).v !== 1) return {};
  const { open, position, positionDefault, machine } = payload as Record<string, unknown>;
  const settings: Settings = {};
  if (typeof open === 'boolean') settings.open = open;
  if (isPosition(position) && isPosition(positionDefault)) {
    settings.position = position;
    settings.positionDefault = positionDefault;
  }
  if (typeof machine === 'string' && machine !== '') settings.machine = machine;
  return settings;
}

/** Best effort: settings that can't be stored last until the page reloads. */
export function writeSettings(settings: Settings): void {
  const storage = defaultStorage();
  if (!storage) return;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ v: 1, ...settings }));
  } catch {
    // Full or blocked storage; the app's own data matters more.
  }
}

/** The corner to use: the stored one while the app's default is still the one it was chosen over. */
export function resolvePosition(settings: Settings, fallback: Position): Position {
  return settings.position !== undefined && settings.positionDefault === fallback ? settings.position : fallback;
}
