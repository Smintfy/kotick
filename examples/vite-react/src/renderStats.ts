import { useLayoutEffect, useRef } from 'react';

type Stats = { mounts: number; renders: number };

// Kept outside React so that a remount, which throws away component state, still counts as a second mount.
const statsByName = new Map<string, Stats>();

/**
 * Counts mounts and committed renders of one component, keyed by `name`.
 *
 * Attach the returned ref to an empty element. The counts are written into it directly, along with
 * `data-mounts` and `data-renders` attributes for tests, so displaying them never causes a render.
 * StrictMode's development-only double render and effect re-run aren't counted.
 */
export function useRenderStats(name: string) {
  const ref = useRef<HTMLElement>(null);
  const mounted = useRef(false);
  const lastRender = useRef<object>(null);
  const thisRender = {};

  useLayoutEffect(() => {
    const stats = statsByName.get(name) ?? { mounts: 0, renders: 0 };
    statsByName.set(name, stats);

    // Refs survive StrictMode's simulated unmount, but not a real remount.
    if (!mounted.current) {
      mounted.current = true;
      stats.mounts += 1;
    }
    // StrictMode re-runs this effect with the same closure, so the render object repeats.
    if (lastRender.current !== thisRender) {
      lastRender.current = thisRender;
      stats.renders += 1;
    }

    const element = ref.current;
    if (element) {
      element.textContent = `mounts ${stats.mounts} · renders ${stats.renders}`;
      element.dataset.stats = name;
      element.dataset.mounts = String(stats.mounts);
      element.dataset.renders = String(stats.renders);
    }
  });

  return ref;
}
