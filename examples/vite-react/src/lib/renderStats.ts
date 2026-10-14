import { useLayoutEffect, useRef } from 'react';

type Stats = { mounts: number; renders: number };

// We keep the counts out of React. A remount removes the component state, but the hook must count it as a new mount.
const statsByName = new Map<string, Stats>();

/**
 * This hook counts the mounts and the committed renders of each `name`.
 *
 * Attach the ref from this hook to an empty element.
 * The hook writes the counts directly into the element. Thus, the counts do not cause a render.
 *
 * In development, StrictMode renders each component two times and calls each effect two times.
 * The hook counts each of them only one time.
 */
export function useRenderStats(name: string) {
  const ref = useRef<HTMLElement>(null);
  const mounted = useRef(false);
  const lastRender = useRef<object>(null);
  const thisRender = {};

  useLayoutEffect(() => {
    const stats = statsByName.get(name) ?? { mounts: 0, renders: 0 };
    statsByName.set(name, stats);

    // A ref stays after the simulated unmount of StrictMode, but not after a remount.
    if (!mounted.current) {
      mounted.current = true;
      stats.mounts += 1;
    }
    // StrictMode calls this effect again with the same closure.
    // Thus, the render object is the same, and the hook does not count it again.
    if (lastRender.current !== thisRender) {
      lastRender.current = thisRender;
      stats.renders += 1;
    }

    const element = ref.current;
    if (element) element.textContent = `mounts ${stats.mounts} · renders ${stats.renders}`;
  });

  return ref;
}
