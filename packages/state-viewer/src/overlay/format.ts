// Turning contexts and events into text for the panel and the clipboard. Contexts can hold anything: actor refs,
// functions, Maps, cycles; none of it may throw.

import type { EventLogEntry } from '../core/types';

/** An object inside a context or an event's payload, as the panel walks it. */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- A context is the app's own data, and it has no schema.
type ContextObject = Record<string, unknown>;

/** What an XState actor ref has. It is shown as `[Actor id]`, not as its properties. */
type ActorRefLike = { sessionId: string; send: Function; getSnapshot: Function };

/** One value as the JSON viewer shows it: a leaf with its text, or a branch with entries to expand. */
type Inspected =
  | { kind: 'leaf'; type: 'string' | 'number' | 'boolean' | 'null' | 'undefined' | 'special'; text: string }
  | { kind: 'branch'; summary: string; entries: () => [string, unknown][]; size: number };

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The panel shows any value of a context.
export function inspect(value: unknown): Inspected {
  if (isObject(value)) return inspectObject(value);

  if (isString(value)) return { kind: 'leaf', type: 'string', text: JSON.stringify(value) };

  if (isNumber(value)) return { kind: 'leaf', type: 'number', text: String(value) };

  if (value === true || value === false) return { kind: 'leaf', type: 'boolean', text: String(value) };

  if (value === undefined) return { kind: 'leaf', type: 'undefined', text: 'undefined' };

  if (isBigInt(value)) return { kind: 'leaf', type: 'number', text: `${value}n` };

  if (isSymbol(value)) return { kind: 'leaf', type: 'special', text: value.toString() };

  if (isFunction(value)) return { kind: 'leaf', type: 'special', text: `ƒ ${value.name || 'anonymous'}()` };

  // Every other kind of value is handled above, so this one is null.
  return { kind: 'leaf', type: 'null', text: 'null' };
}

function inspectObject(value: ContextObject): Inspected {
  const special = describeSpecial(value);

  if (special !== undefined) return { kind: 'leaf', type: 'special', text: special };

  if (Array.isArray(value)) {
    return {
      kind: 'branch',
      summary: `Array(${value.length})`,
      size: value.length,
      entries: () => value.map((item, index) => [String(index), item]),
    };
  }

  if (value instanceof Map) {
    return {
      kind: 'branch',
      summary: `Map(${value.size})`,
      size: value.size,
      entries: () => [...value].map(([key, item]) => [isString(key) ? key : String(key), item]),
    };
  }

  if (value instanceof Set) {
    return {
      kind: 'branch',
      summary: `Set(${value.size})`,
      size: value.size,
      entries: () => [...value].map((item, index) => [String(index), item]),
    };
  }

  let keys: string[];

  try {
    keys = Object.keys(value);
  } catch {
    return { kind: 'leaf', type: 'special', text: '[Unreadable]' };
  }

  const name = constructorName(value);

  return {
    kind: 'branch',
    summary: name && name !== 'Object' ? `${name} {…}` : keys.length === 0 ? '{}' : '{…}',
    size: keys.length,
    entries: () => keys.map((key) => entryOf(value, key)),
  };
}

/**
 * JSON for the clipboard. Cycles, functions, actors, Maps and Sets become readable placeholders rather than errors,
 * and `undefined` properties are left out as JSON.stringify does.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The clipboard gets any value of a context.
export function toJson(value: unknown, space: number | string = 2): string {
  const ancestors: unknown[] = [];

  try {
    const text = JSON.stringify(
      value,
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- `item` is what toJSON() gave for any value of a context.
      function replacer(this: ContextObject, key: string, item: unknown) {
        // `item` is what toJSON() returned. Actors have one that hides what they are, so placeholders use the raw
        // value.
        const raw = this[key];

        if (isObject(raw)) {
          const special = describeSpecial(raw);

          if (special !== undefined) return special;
        }

        if (isBigInt(item)) return `${item}n`;

        if (isSymbol(item)) return item.toString();

        if (isFunction(item)) return `[Function ${item.name || 'anonymous'}]`;

        if (!isObject(item)) return item;

        // `this` is the object holding `item`; ancestors above it are done.
        while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) ancestors.pop();

        if (ancestors.includes(item)) return '[Circular]';
        ancestors.push(item);

        if (item instanceof Map) return Object.fromEntries([...item].map(([key, entry]) => [String(key), entry]));

        if (item instanceof Set) return [...item];

        return item;
      },
      space,
    );

    return text ?? 'undefined';
  } catch (error) {
    return JSON.stringify(`[Unserializable: ${error instanceof Error ? error.message : String(error)}]`);
  }
}

/** A short one-line form of an event's payload, without its type: `{ cardNumber: "4242…" }`. */
export function summarizePayload(event: EventLogEntry['event']): string {
  const { type: _type, ...payload } = event;

  if (Object.keys(payload).length === 0) return '';

  return toJson(payload, 0);
}

/** `14:03:27.041`, in local time. */
export function formatTime(at: number): string {
  const date = new Date(at);

  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

  return `${time}.${pad(date.getMilliseconds(), 3)}`;
}

/** Placeholders for objects whose properties say nothing useful, or that would be dangerous to walk. */
function describeSpecial(value: ContextObject): string | undefined {
  try {
    if (isActorRef(value)) {
      const id = 'id' in value && isString(value.id) ? value.id : value.sessionId;

      return `[Actor ${id}]`;
    }

    if (typeof Node !== 'undefined' && value instanceof Node) return `[${value.nodeName.toLowerCase()}]`;

    if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();

    if (value instanceof Error) return `${value.name}: ${value.message}`;

    if (value instanceof RegExp) return String(value);

    if (typeof Promise !== 'undefined' && value instanceof Promise) return '[Promise]';

    if (typeof WeakMap !== 'undefined' && (value instanceof WeakMap || value instanceof WeakSet)) {
      return `[${constructorName(value)}]`;
    }
  } catch {
    return '[Unreadable]';
  }

  return undefined;
}

function isActorRef(value: ContextObject): value is ActorRefLike {
  return isString(value.sessionId) && isFunction(value.send) && isFunction(value.getSnapshot);
}

function constructorName(value: ContextObject): string | undefined {
  try {
    const prototype: unknown = Object.getPrototypeOf(value);

    if (!isObject(prototype)) return undefined;
    const { constructor } = prototype;
    const name = isObject(constructor) || isFunction(constructor) ? constructor.name : undefined;

    return isString(name) ? name : undefined;
  } catch {
    return undefined;
  }
}

/** One entry of an object. A getter that throws shows as unreadable. */
function entryOf(value: ContextObject, key: string): [string, unknown] {
  try {
    return [key, value[key]];
  } catch {
    return [key, '[Unreadable]'];
  }
}

function isObject(value: unknown): value is ContextObject {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

function isBigInt(value: unknown): value is bigint {
  return typeof value === 'bigint';
}

function isSymbol(value: unknown): value is symbol {
  return typeof value === 'symbol';
}

function isFunction(value: unknown): value is Function {
  return typeof value === 'function';
}
