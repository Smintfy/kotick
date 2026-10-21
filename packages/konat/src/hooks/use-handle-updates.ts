import * as React from 'react';
import type { MachineHandle } from '../types';

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
      console.warn(`[konat] Can't follow "${handle.machineId}#${handle.instanceId}": subscribe() threw.`, error);
    }

    // A change between the render and this effect would otherwise go unseen.
    update();

    return () => unsubscribe?.();
  }, [handle]);
}
