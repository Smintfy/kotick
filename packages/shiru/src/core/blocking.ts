import type { EventLogEntry, Override, Registry } from '../types';

/** What an adapter's types let an app send. */
interface SentEvent {
  readonly type: string;
}

/**
 * Logs an event that the UI sends during a preview as blocked, and returns true, so that the adapter drops it.
 * It returns false when the instance shows no preview.
 */
export function blockIfPreviewing(
  registry: Pick<Registry, 'logEvent'>,
  override: Override | undefined,
  event: SentEvent,
): boolean {
  if (!override) return false;

  if (!isLoggableEvent(event)) {
    console.warn(
      `[shiru] Dropped an event without a string type sent to "${override.instanceKey}" during a preview.`,
      event,
    );

    return true;
  }

  registry.logEvent({ instanceKey: override.instanceKey, event, leaves: override.leaves, at: Date.now() });

  return true;
}

/** A caller without types can send any value. The registry logs only events with a string type. */
function isLoggableEvent(event: SentEvent): event is EventLogEntry['event'] {
  return typeof event === 'object' && event !== null && 'type' in event && typeof event.type === 'string';
}
