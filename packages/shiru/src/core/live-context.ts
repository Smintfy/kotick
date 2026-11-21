import type { MachineHandle, PreviewLeaves } from '../types';

/**
 * Whether the live context of the handle can be the context of a preview of `leaves`.
 * It is the one rule for the live context. The registry and the overlay both ask it.
 * So the panel never offers what the registry refuses.
 */
export function liveContextFits(
  handle: Pick<MachineHandle, 'capabilities' | 'getActiveLeaves'>,
  leaves: PreviewLeaves,
): boolean {
  // A handle from an older copy of shiru on the page has no `sharedContext`, so it counts as shared.
  if (handle.capabilities?.sharedContext !== false) return true;

  try {
    const active = handle.getActiveLeaves();

    return [...leaves.requested, ...leaves.filled].every((leaf) => active.includes(leaf));
  } catch {
    return false;
  }
}

/**
 * The live context for a preview of `leaves`, or undefined when it doesn't fit them.
 * The registry reads the live context only through this function.
 * A throw from getContext() goes to the caller.
 */
export function liveContextOf(
  handle: Pick<MachineHandle, 'capabilities' | 'getActiveLeaves' | 'getContext'>,
  leaves: PreviewLeaves,
): { source: 'live'; context: unknown } | undefined {
  return liveContextFits(handle, leaves) ? { source: 'live', context: handle.getContext() } : undefined;
}
