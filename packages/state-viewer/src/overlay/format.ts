// Turning contexts and events into text for the panel and the clipboard. Contexts can hold anything: actor refs,
// functions, Maps, cycles; none of it may throw.

/** One value as the JSON viewer shows it: a leaf with its text, or a branch with entries to expand. */
export type Inspected =
  | { kind: 'leaf'; type: 'string' | 'number' | 'boolean' | 'null' | 'undefined' | 'special'; text: string }
  | { kind: 'branch'; summary: string; entries: () => [string, unknown][]; size: number };

export function inspect(value: unknown): Inspected {
  switch (typeof value) {
    case 'string':
      return { kind: 'leaf', type: 'string', text: JSON.stringify(value) };
    case 'number':
      return { kind: 'leaf', type: 'number', text: String(value) };
    case 'boolean':
      return { kind: 'leaf', type: 'boolean', text: String(value) };
    case 'undefined':
      return { kind: 'leaf', type: 'undefined', text: 'undefined' };
    case 'bigint':
      return { kind: 'leaf', type: 'number', text: `${value}n` };
    case 'symbol':
      return { kind: 'leaf', type: 'special', text: value.toString() };
    case 'function':
      return { kind: 'leaf', type: 'special', text: `ƒ ${value.name || 'anonymous'}()` };
  }
  if (value === null) return { kind: 'leaf', type: 'null', text: 'null' };
  const special = describeSpecial(value as object);
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
      entries: () => [...value].map(([key, item]) => [typeof key === 'string' ? key : String(key), item]),
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
  const object = value as object;
  let keys: string[];
  try {
    keys = Object.keys(object);
  } catch {
    return { kind: 'leaf', type: 'special', text: '[Unreadable]' };
  }
  const name = constructorName(object);
  return {
    kind: 'branch',
    summary: name && name !== 'Object' ? `${name} {…}` : keys.length === 0 ? '{}' : '{…}',
    size: keys.length,
    entries: () => keys.map((key) => [key, readProperty(object, key)]),
  };
}

/**
 * JSON for the clipboard. Cycles, functions, actors, Maps and Sets become readable placeholders rather than errors,
 * and `undefined` properties are left out as JSON.stringify does.
 */
export function toJson(value: unknown, space: number | string = 2): string {
  const ancestors: unknown[] = [];
  try {
    const text = JSON.stringify(
      value,
      function replacer(this: unknown, key: string, item: unknown) {
        // `item` is what toJSON() returned. Actors have one that hides what they are, so placeholders use the raw
        // value.
        const raw = (this as Record<string, unknown>)[key];
        if (typeof raw === 'object' && raw !== null) {
          const special = describeSpecial(raw);
          if (special !== undefined) return special;
        }
        if (typeof item === 'bigint') return `${item}n`;
        if (typeof item === 'symbol') return item.toString();
        if (typeof item === 'function') return `[Function ${item.name || 'anonymous'}]`;
        if (typeof item !== 'object' || item === null) return item;
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
export function summarizePayload(event: { type: string; [key: string]: unknown }): string {
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
function describeSpecial(value: object): string | undefined {
  try {
    if (isActorRef(value)) {
      const { id, sessionId } = value as { id?: unknown; sessionId: string };
      return `[Actor ${typeof id === 'string' ? id : sessionId}]`;
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

function isActorRef(value: object): boolean {
  const candidate = value as { sessionId?: unknown; send?: unknown; getSnapshot?: unknown };
  return (
    typeof candidate.sessionId === 'string' &&
    typeof candidate.send === 'function' &&
    typeof candidate.getSnapshot === 'function'
  );
}

function constructorName(value: object): string | undefined {
  try {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto === null) return undefined;
    const name: unknown = (proto as { constructor?: { name?: unknown } }).constructor?.name;
    return typeof name === 'string' ? name : undefined;
  } catch {
    return undefined;
  }
}

function readProperty(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return '[Unreadable]';
  }
}
