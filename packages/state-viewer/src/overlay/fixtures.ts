// Loading `<StateViewer fixtures>` (R18): sets given directly, or a loader such as `() => import('./debug/fixtures')`.

import type { FixtureSet } from '../core/types';
import type { FixturesInput } from './types';

/** The sets the input gives, or none with a warning when it gives something else or the loader fails. */
export async function loadFixtures(input: FixturesInput): Promise<FixtureSet[]> {
  let result: unknown;
  try {
    result = typeof input === 'function' ? await input() : input;
  } catch (error) {
    console.warn('[state-viewer] The fixtures loader failed.', error);
    return [];
  }
  // A module namespace from import(), whose default export is the sets.
  if (!Array.isArray(result) && typeof result === 'object' && result !== null && 'default' in result) {
    result = (result as { default: unknown }).default;
  }
  if (!Array.isArray(result)) {
    console.warn(
      '[state-viewer] Expected fixtures to be an array of sets from defineFixtures(), ' +
        'or a module whose default export is one.',
    );
    return [];
  }
  const sets = result.filter(isFixtureSet);
  if (sets.length < result.length) {
    console.warn('[state-viewer] Ignoring fixture entries that are not sets from defineFixtures().');
  }
  return sets;
}

function isFixtureSet(value: unknown): value is FixtureSet {
  if (typeof value !== 'object' || value === null) return false;
  const { machineId, states } = value as Partial<FixtureSet>;
  return typeof machineId === 'string' && typeof states === 'object' && states !== null;
}
