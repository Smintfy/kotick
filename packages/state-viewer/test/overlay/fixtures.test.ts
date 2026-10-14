import { afterEach, describe, expect, test, vi } from 'vitest';
import type { FixtureSet } from '../../src/core/types';
import { loadFixtures } from '../../src/overlay/fixtures';

const set: FixtureSet = { machineId: 'checkout', states: { idle: { context: {} } } };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadFixtures', () => {
  test('takes sets given directly, from a loader, or as a module’s default export', async () => {
    expect(await loadFixtures([set])).toEqual([set]);
    expect(await loadFixtures(() => [set])).toEqual([set]);
    expect(await loadFixtures(async () => ({ default: [set] }))).toEqual([set]);
  });

  test('warns and gives nothing when the loader fails or gives something else', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await loadFixtures(() => Promise.reject(new Error('404')))).toEqual([]);
    expect(await loadFixtures((() => ({ default: 'nope' })) as never)).toEqual([]);
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      '[state-viewer] The fixtures loader failed.',
      expect.stringMatching(/^\[state-viewer\] Expected fixtures to be an array/),
    ]);
  });

  test('drops entries that aren’t fixture sets, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await loadFixtures([set, null, { machineId: 'x' }] as never)).toEqual([set]);
    expect(warn).toHaveBeenCalledWith('[state-viewer] Ignoring fixture entries that are not sets from defineFixtures().');
  });
});
