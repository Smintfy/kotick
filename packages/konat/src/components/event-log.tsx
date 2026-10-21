// The event log: events the UI sent during a preview, newest first, with the state it showed and when.

import { useId } from 'react';
import type { EventLogEntry } from '../types';
import { formatTime, summarizePayload } from '../utils/format';
import { BUTTON, HINT, SECTION, SECTION_HEAD, SECTION_TITLE } from './classes';

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
    <section className={SECTION} aria-labelledby={titleId}>
      <div className={SECTION_HEAD}>
        <h3 className={SECTION_TITLE} id={titleId}>
          Blocked events{entries.length > 0 && ` (${entries.length})`}
        </h3>
        <button type="button" className={BUTTON} onClick={onClear} disabled={entries.length === 0}>
          Clear
        </button>
      </div>
      {entries.length === 0 ? (
        <p className={HINT} data-part="hint">Events the UI sends during a preview are blocked and listed here.</p>
      ) : (
        <ol className="grid gap-0.5" aria-labelledby={titleId}>
          {[...entries].reverse().map((entry) => {
            const payload = summarizePayload(entry.event);
            const leaves = Array.isArray(entry.leaves) ? entry.leaves.join(', ') : '';

            return (
              <li
                key={keyOf(entry)}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-px rounded-md bg-surface px-2 py-1.5"
                data-part="log-entry"
              >
                <span className="truncate font-mono text-base font-semibold" data-part="event">{entry.event.type}</span>
                <span className="text-sm text-muted tabular-nums" data-part="time">{formatTime(entry.at)}</span>
                <span className="col-span-full truncate text-sm text-muted" data-part="log-meta" title={leaves}>
                  {labelOf(entry.instanceKey)} · {entry.blocked ? 'in' : 'delivered in'} {leaves}
                </span>
                {payload && (
                  <code className="col-span-full truncate font-mono text-sm text-muted" data-part="payload" title={payload}>
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
