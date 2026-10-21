// What the overlay stores in sessionStorage, read and checked as a page reload would find it.

import type { Json } from './json';

/** A recording as the overlay stores it. */
type Entry = { leaves: string[]; at: number; context: Json };

type Payload = { v: number; entries: Entry[] };

export function recordedKey(machineId: string): string {
  return `konat:recorded:${machineId}`;
}

/** The stored recordings of a machine, or null when it has none. A payload of the wrong form fails the test. */
export function readStored(machineId: string): Payload | null {
  const raw = sessionStorage.getItem(recordedKey(machineId));

  if (raw === null) return null;

  const stored: Json = JSON.parse(raw);

  if (!isPayload(stored)) throw new Error(`The recordings of ${machineId} are not a payload: ${raw.slice(0, 200)}`);

  return stored;
}

function isPayload(value: Json): value is Payload {
  return isRecord(value) && typeof value.v === 'number' && Array.isArray(value.entries) && value.entries.every(isEntry);
}

function isEntry(value: Json): value is Entry {
  return (
    isRecord(value) &&
    Array.isArray(value.leaves) &&
    value.leaves.every(isLeafId) &&
    typeof value.at === 'number' &&
    'context' in value
  );
}

function isLeafId(value: Json): value is string {
  return typeof value === 'string';
}

function isRecord(value: Json): value is { [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
