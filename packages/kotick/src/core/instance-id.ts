const COUNTER_KEY = '__KOTICK_LAST_INSTANCE__';

/**
 * The counter lives on globalThis, so every adapter, every React root and every copy of the package draw from one
 * sequence, and two instance keys never collide.
 * React's useId isn't enough, because separately hydrated roots each start from the same tree-position ids.
 * So two islands that render one machine would share a key.
 */
export function nextInstanceId(): string {
  // SAFETY: The counter is a property this package adds to globalThis, under a key that nothing else uses.
  const scope = globalThis as typeof globalThis & { [COUNTER_KEY]?: number };
  const next = (scope[COUNTER_KEY] ?? 0) + 1;
  scope[COUNTER_KEY] = next;

  return String(next);
}
