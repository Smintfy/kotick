import type { KonatProps } from '../types';

interface Shortcut {
  /** `KeyboardEvent.key`, lowercased: 's', 'escape', 'f2'. */
  key: string;
  /** The physical key for letters and digits, which Alt changes the `key` of on macOS (Alt+S types 'ß'). */
  code?: string;
  alt: boolean;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
}

type Modifier = 'alt' | 'ctrl' | 'shift' | 'meta';

const MODIFIERS = new Map<string, Modifier>([
  ['alt', 'alt'],
  ['option', 'alt'],
  ['opt', 'alt'],
  ['ctrl', 'ctrl'],
  ['control', 'ctrl'],
  ['shift', 'shift'],
  ['meta', 'meta'],
  ['cmd', 'meta'],
  ['command', 'meta'],
]);

const KEY_NAMES = new Map<string, string>([
  ['esc', 'escape'],
  ['space', ' '],
  ['spacebar', ' '],
  ['up', 'arrowup'],
  ['down', 'arrowdown'],
  ['left', 'arrowleft'],
  ['right', 'arrowright'],
  ['return', 'enter'],
  ['del', 'delete'],
  ['plus', '+'],
]);

/** A JS app can pass any value as the shortcut prop. */
export function isShortcutText(value: KonatProps['shortcut']): value is string {
  return typeof value === 'string';
}

/** `undefined` when the text names no key or an unknown modifier. */
export function parseShortcut(value: string): Shortcut | undefined {
  const parts = value
    .toLowerCase()
    .split('+')
    .map((part) => part.trim());

  const name = parts.pop();

  if (!name) return undefined;
  const shortcut: Shortcut = { key: KEY_NAMES.get(name) ?? name, alt: false, ctrl: false, shift: false, meta: false };

  for (const part of parts) {
    const modifier = part === 'mod' ? (isApple() ? 'meta' : 'ctrl') : MODIFIERS.get(part);

    if (!modifier) return undefined;
    shortcut[modifier] = true;
  }

  if (/^[a-z]$/.test(shortcut.key)) shortcut.code = `Key${shortcut.key.toUpperCase()}`;
  else if (/^[0-9]$/.test(shortcut.key)) shortcut.code = `Digit${shortcut.key}`;

  return shortcut;
}

const MODIFIER_LABELS: Record<Platform, Record<Modifier, string>> = {
  apple: { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' },
  windows: { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' },
  other: { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Super' },
};

/** The order of macOS menus: ⌃⌥⇧⌘. Windows and Linux put Ctrl, Alt and Shift in the same order. */
const MODIFIER_ORDER: readonly Modifier[] = ['ctrl', 'alt', 'shift', 'meta'];

const KEY_LABELS = new Map<string, string>([
  ['escape', 'Esc'],
  [' ', 'Space'],
  ['arrowup', '↑'],
  ['arrowdown', '↓'],
  ['arrowleft', '←'],
  ['arrowright', '→'],
]);

/** The shortcut as the operating system writes it: '⌥S' on macOS and iOS, 'Alt+S' on other systems. */
export function formatShortcut(shortcut: Shortcut): string {
  const os = platform();
  const modifiers = MODIFIER_ORDER.flatMap((modifier) => (shortcut[modifier] ? [MODIFIER_LABELS[os][modifier]] : []));
  const key = KEY_LABELS.get(shortcut.key) ?? shortcut.key.charAt(0).toUpperCase() + shortcut.key.slice(1);

  return [...modifiers, key].join(os === 'apple' ? '' : '+');
}

export function matchesShortcut(shortcut: Shortcut, event: KeyboardEvent): boolean {
  if (
    event.altKey !== shortcut.alt ||
    event.ctrlKey !== shortcut.ctrl ||
    event.shiftKey !== shortcut.shift ||
    event.metaKey !== shortcut.meta
  ) {
    return false;
  }

  // Either the character or the physical key, so Alt+S works on macOS and on layouts that move letters.
  return event.key.toLowerCase() === shortcut.key || event.code === shortcut.code;
}

const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
  'date',
  'datetime-local',
  'month',
  'week',
  'time',
]);

export function isTyping(target: EventTarget | null | undefined): boolean {
  if (!isElement(target)) return false;

  if (target.localName === 'textarea') return true;

  if (isInput(target)) return TEXT_INPUT_TYPES.has(target.type);

  // isContentEditable also covers inherited editability; the selector is for DOMs that don't implement it (jsdom).
  return ('isContentEditable' in target && target.isContentEditable === true) || target.closest(EDITABLE) !== null;
}

/**
 * The check reads nodeType, not instanceof, so an element of another window counts.
 * The overlay can be in the document of an iframe or a popup.
 */
export function isElement(target: EventTarget | null | undefined): target is Element {
  return target !== null && target !== undefined && 'nodeType' in target && target.nodeType === Node.ELEMENT_NODE;
}

function isInput(element: Element): element is HTMLInputElement {
  return element.localName === 'input';
}

const EDITABLE = '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

/** The element a key event started on, inside shadow roots too (the event is retargeted to their hosts). */
export function eventOrigin(event: Event): EventTarget | null {
  return event.composedPath()[0] ?? event.target;
}

type Platform = 'apple' | 'windows' | 'other';

function platform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  // Some browsers and jsdom give an empty platform. The user agent also names the system.
  const name = navigator.platform || navigator.userAgent;

  if (/Mac|iPhone|iPad|iPod/.test(name)) return 'apple';

  return /Win/.test(name) ? 'windows' : 'other';
}

export function isApple(): boolean {
  return platform() === 'apple';
}

export type Move = 'next' | 'previous' | 'first' | 'last';

const MOVES = new Map<string, Move>([
  ['ArrowDown', 'next'],
  ['ArrowUp', 'previous'],
  ['Home', 'first'],
  ['End', 'last'],
]);

/** Apple has no Home and End keys on most keyboards, so ⌘↑ and ⌘↓ also go to the first and last item there. */
export function moveOf(event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey'>): Move | undefined {
  if (event.altKey || event.ctrlKey) return undefined;

  if (!event.metaKey) return MOVES.get(event.key);

  if (!isApple()) return undefined;

  return event.key === 'ArrowUp' ? 'first' : event.key === 'ArrowDown' ? 'last' : undefined;
}

/** `index` is -1 when no item is current. A move stops at the ends. */
export function moveIndex(index: number, length: number, move: Move): number {
  switch (move) {
    case 'first':
      return 0;
    case 'last':
      return length - 1;
    case 'next':
      return Math.min(index + 1, length - 1);
    case 'previous':
      return Math.max(index - 1, 0);
  }
}
