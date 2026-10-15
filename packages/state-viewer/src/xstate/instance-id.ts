const COUNTER_KEY = '__STATE_VIEWER_LAST_INSTANCE__';

/**
 * A page-unique instance id. The counter lives on globalThis, so every React root and every copy of the
 * package draw from one sequence. React's useId isn't enough: separately hydrated roots each start from the same
 * tree-position ids, so two islands rendering one machine would share a key.
 */
export function nextInstanceId(): string {
  const scope = globalThis as typeof globalThis & { [COUNTER_KEY]?: number };
  const next = (scope[COUNTER_KEY] ?? 0) + 1;
  scope[COUNTER_KEY] = next;
  return String(next);
}
