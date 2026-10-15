import type { EventLogEntry } from './types';

export interface EventLog {
  push(entry: EventLogEntry): void;
  clear(): void;
  /** Entries oldest first, as a new array. */
  toArray(): EventLogEntry[];
  readonly size: number;
}

export function createEventLog(capacity = 200): EventLog {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(`[state-viewer] Event log capacity must be a positive integer, got ${String(capacity)}`);
  }

  // Grows to `capacity` on the first lap, then overwrites in place, so an unused log doesn't allocate every slot.
  let buffer: EventLogEntry[] = [];
  // Index of the oldest entry once the buffer is full.
  let head = 0;

  return {
    push(entry) {
      if (buffer.length < capacity) {
        buffer.push(entry);
        return;
      }
      buffer[head] = entry;
      head = (head + 1) % capacity;
    },
    clear() {
      buffer = [];
      head = 0;
    },
    toArray() {
      return head === 0 ? buffer.slice() : buffer.slice(head).concat(buffer.slice(0, head));
    },
    get size() {
      return buffer.length;
    },
  };
}
