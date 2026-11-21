import { useReducer } from 'react';
import { useIsomorphicLayoutEffect } from './use-isomorphic-layout-effect';

/**
 * In a passive effect, useSyncExternalStore subscribes and checks the snapshot that it rendered.
 * A passive effect runs after the paint, unless the commit was synchronous.
 * A hidden Activity unregisters the hooks in it, and the registry then ends their previews.
 * The Activity can show a component again without a new render, so the last render can still show that preview.
 * This layout effect re-renders it synchronously, so the first paint shows the real snapshot.
 */
export function useSnapshotCheck<T>(read: () => T, rendered: T): void {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  useIsomorphicLayoutEffect(() => {
    if (!Object.is(read(), rendered)) rerender();
  });
}
