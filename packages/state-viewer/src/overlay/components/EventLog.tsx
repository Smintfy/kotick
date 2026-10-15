// The event log: events the UI sent during a preview, newest first, with the state it showed and when.

import { useId } from 'react';
import type { EventLogEntry } from '../../core/types';
import { formatTime, summarizePayload } from '../format';

// Entries have no id, and the ring buffer shifts their positions; React keys come from the objects themselves.
const entryKeys = new WeakMap<EventLogEntry, number>();
let nextEntryKey = 0;

function keyOf(entry: EventLogEntry): number {
  let key = entryKeys.get(entry);
  if (key === undefined) {
    key = nextEntryKey++;
    entryKeys.set(entry, key);
  }
  return key;
}

interface EventLogProps {
  entries: readonly EventLogEntry[];
  /** `checkout · 1` for an instance key; the key itself once the instance is gone. */
  labelOf(instanceKey: string): string;
  onClear(): void;
}

export function EventLog({ entries, labelOf, onClear }: EventLogProps) {
  const titleId = useId();
  return (
    <section className="sv-section" aria-labelledby={titleId}>
      <div className="sv-section-head">
        <h3 className="sv-section-title" id={titleId}>
          Blocked events{entries.length > 0 && ` (${entries.length})`}
        </h3>
        <button type="button" className="sv-button" onClick={onClear} disabled={entries.length === 0}>
          Clear
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="sv-hint">Events the UI sends during a preview are blocked and listed here.</p>
      ) : (
        <ol className="sv-log" aria-labelledby={titleId}>
          {[...entries].reverse().map((entry) => {
            const payload = summarizePayload(entry.event);
            const leaves = Array.isArray(entry.leaves) ? entry.leaves.join(', ') : '';
            return (
              <li key={keyOf(entry)} className="sv-log-entry">
                <span className="sv-event">{entry.event.type}</span>
                <span className="sv-time">{formatTime(entry.at)}</span>
                <span className="sv-log-meta" title={leaves}>
                  {labelOf(entry.instanceKey)} · {entry.blocked ? 'in' : 'delivered in'} {leaves}
                </span>
                {payload && (
                  <code className="sv-payload" title={payload}>
                    {payload}
                  </code>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
