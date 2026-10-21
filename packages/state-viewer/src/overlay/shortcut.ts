// Keyboard shortcuts. The toggle is configurable, such as 'alt+s' or 'ctrl+shift+d', and every shortcut
// is ignored while the user types. The arrows, Home and End move through the rows of a page.

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

const MODIFIERS: Readonly<Record<string, Modifier>> = {
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  ctrl: 'ctrl',
  control: 'ctrl',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
};

const KEY_NAMES: Readonly<Record<string, string>> = {
  esc: 'escape',
  space: ' ',
  spacebar: ' ',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  return: 'enter',
  del: 'delete',
  plus: '+',
};

/** Parses a shortcut such as 'alt+s'; `undefined` when it names no key or an unknown modifier. */
export function parseShortcut(value: string): Shortcut | undefined {
  if (typeof value !== 'string') return undefined;

  const parts = value
    .toLowerCase()
    .split('+')
    .map((part) => part.trim());

  const name = parts.pop();

  if (!name) return undefined;
  const shortcut: Shortcut = { key: KEY_NAMES[name] ?? name, alt: false, ctrl: false, shift: false, meta: false };

  for (const part of parts) {
    const modifier = part === 'mod' ? (isApple() ? 'meta' : 'ctrl') : MODIFIERS[part];

    if (!modifier) return undefined;
    shortcut[modifier] = true;
  }

  if (/^[a-z]$/.test(shortcut.key)) shortcut.code = `Key${shortcut.key.toUpperCase()}`;
  else if (/^[0-9]$/.test(shortcut.key)) shortcut.code = `Digit${shortcut.key}`;

  return shortcut;
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
  return (typeof event.key === 'string' && event.key.toLowerCase() === shortcut.key) || event.code === shortcut.code;
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

/** Whether keys pressed on `target` type text: text inputs, textareas and contenteditable elements. */
export function isTyping(target: EventTarget | null | undefined): boolean {
  if (!isElement(target)) return false;
  const tag = target.localName;

  if (tag === 'textarea') return true;

  if (tag === 'input') return TEXT_INPUT_TYPES.has((target as HTMLInputElement).type);

  // isContentEditable also covers inherited editability; the selector is for DOMs that don't implement it (jsdom).
  return (target as HTMLElement).isContentEditable === true || target.closest(EDITABLE) !== null;
}

const EDITABLE = '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

/** The element a key event started on, inside shadow roots too (the event is retargeted to their hosts). */
export function eventOrigin(event: Event): EventTarget | null {
  return typeof event.composedPath === 'function' ? (event.composedPath()[0] ?? event.target) : event.target;
}

function isElement(target: EventTarget | null | undefined): target is Element {
  return typeof target === 'object' && target !== null && (target as Node).nodeType === 1;
}

function isApple(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? '');
}

export type Move = 'next' | 'previous' | 'first' | 'last';

const MOVES: Readonly<Record<string, Move>> = { ArrowDown: 'next', ArrowUp: 'previous', Home: 'first', End: 'last' };

/** The move that `KeyboardEvent.key` makes through rows or leaves, if any. */
export function moveOf(key: string): Move | undefined {
  return Object.hasOwn(MOVES, key) ? MOVES[key] : undefined;
}

/** The index a move goes to among `length` items. `index` is -1 when no item is current. A move stops at the ends. */
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
