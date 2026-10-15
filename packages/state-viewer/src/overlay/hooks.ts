import * as React from 'react';
import type { MachineHandle, Registry, RegistrySnapshot } from '../core/types';

// Layout effects don't run on the server, and React 18 warns when they're used there.
export const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

/** The registry's snapshot, which changes only when machines, previews, the log or data markers do. */
export function useRegistrySnapshot(registry: Registry): RegistrySnapshot {
  return React.useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
}

/**
 * Re-renders on the handle's real state changes, which the registry snapshot leaves out: its active leaves and live
 * context. Only the open panel listens, so a closed one costs nothing per transition.
 */
export function useHandleUpdates(handle: MachineHandle | undefined): void {
  const [, update] = React.useReducer((count: number) => count + 1, 0);
  React.useEffect(() => {
    if (!handle) return;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = handle.subscribe(() => update());
    } catch (error) {
      console.warn(`[state-viewer] Can't follow "${handle.machineId}#${handle.instanceId}": subscribe() threw.`, error);
    }
    // A change between the render and this effect would otherwise go unseen.
    update();
    return () => unsubscribe?.();
  }, [handle]);
}

/** The value from the latest commit, for listeners set up once. */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = React.useRef(value);
  useIsomorphicLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
