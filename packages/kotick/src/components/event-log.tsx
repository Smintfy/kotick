import { Fragment, useId } from 'react';
import type { EventLogEntry } from '../types';
import { formatClock, formatTime, summarizePayload } from '../utils/format';
import { BUTTON, CHIP, HINT, SECTION, SECTION_HEAD, SECTION_TITLE, TAG } from './classes';
import { ChevronIcon } from './icons';

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

/** Events that the UI sent one after another, with the same type, payload, instance and state. */
interface Run {
  /** Newest first. */
  entries: EventLogEntry[];
  payload: string;
}

/** Newest run first. */
function runsOf(entries: readonly EventLogEntry[]): Run[] {
  const runs: Run[] = [];

  for (const entry of entries) {
    const payload = summarizePayload(entry.event);
    const run = runs.at(-1);
    const last = run?.entries[0];

    const repeats =
      run !== undefined &&
      last !== undefined &&
      run.payload === payload &&
      last.instanceKey === entry.instanceKey &&
      last.event.type === entry.event.type &&
      last.leaves.join() === entry.leaves.join();

    if (repeats) run.entries.unshift(entry);
    else runs.push({ entries: [entry], payload });
  }

  return runs.reverse();
}

interface EventLogProps {
  entries: readonly EventLogEntry[];
  /** The instance on the page. Events from other instances show their label. */
  instanceKey: string;
  /** Falls back to the key itself once the instance is gone. */
  labelOf(instanceKey: string): string;
  onClear(): void;
}

export function EventLog({ entries, instanceKey, labelOf, onClear }: EventLogProps) {
  const titleId = useId();

  return (
    <section className={SECTION} aria-labelledby={titleId}>
      <div className={SECTION_HEAD}>
        <h3 className={SECTION_TITLE} id={titleId}>
          Blocked events
        </h3>
        {entries.length > 0 && (
          <>
            <span className={CHIP} data-part="count">
              {entries.length}
            </span>
            <button type="button" className={BUTTON} onClick={onClear}>
              Clear
            </button>
          </>
        )}
      </div>
      {entries.length === 0 ? (
        <p className={HINT} data-part="hint">Events sent during a preview show here.</p>
      ) : (
        <ol className="grid gap-px" aria-labelledby={titleId}>
          {runsOf(entries).map((run) => (
            // The oldest entry of a run stays while repeats join it, so an open row stays open.
            <RunRow key={keyOf(run.entries.at(-1) ?? run.entries[0])} run={run} instanceKey={instanceKey} labelOf={labelOf} />
          ))}
        </ol>
      )}
    </section>
  );
}

function RunRow({ run, instanceKey, labelOf }: { run: Run; instanceKey: string; labelOf(instanceKey: string): string }) {
  const [newest] = run.entries;
  const oldest = run.entries.at(-1) ?? newest;
  const count = run.entries.length;

  return (
    <li data-part="log-entry">
      <details className="group/entry">
        <summary className="flex min-h-6 items-center gap-1.5 rounded-md py-0.5 pr-1.5 pl-1.5 hover:bg-hover focus-visible:outline-offset-[-2px]">
          <ChevronIcon
            size={12}
            className="flex-none text-muted [transition:transform_100ms_ease] group-not-open/entry:transform-[rotate(-90deg)] motion-reduce:[transition:none]"
          />
          <span className="flex-none font-mono text-base font-semibold" data-part="event">{newest.event.type}</span>
          {count > 1 && (
            <span className={CHIP} data-part="repeats">
              ×{count}
            </span>
          )}
          <span className="min-w-0 flex-auto truncate font-mono text-base text-muted" data-part="payload">{run.payload}</span>
          {newest.instanceKey !== instanceKey && (
            <span className={TAG} data-part="tag">
              {labelOf(newest.instanceKey)}
            </span>
          )}
          <span className="flex-none text-base text-muted tabular-nums" data-part="time">{formatClock(newest.at)}</span>
        </summary>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-0.5 pt-0.5 pr-1.5 pb-2 pl-6 text-base">
          <dt className="text-muted">State</dt>
          <dd className="grid min-w-0 font-mono" data-part="log-state">
            {newest.leaves.map((leaf) => (
              // A long path wraps after a dot, never inside a key, and its next line is indented.
              <span key={leaf} className="pl-2 -indent-2">
                {leaf.split('.').map((part, index) => (
                  <Fragment key={index}>
                    {index > 0 && <>.<wbr /></>}
                    {part}
                  </Fragment>
                ))}
              </span>
            ))}
          </dd>
          <dt className="text-muted">Instance</dt>
          <dd className="font-mono" data-part="log-instance">{labelOf(newest.instanceKey)}</dd>
          <dt className="text-muted">{count > 1 ? 'Last sent' : 'Sent'}</dt>
          <dd className="tabular-nums">{formatTime(newest.at)}</dd>
          {count > 1 && (
            <>
              <dt className="text-muted">First sent</dt>
              <dd className="tabular-nums">{formatTime(oldest.at)}</dd>
            </>
          )}
          {run.payload && (
            <>
              <dt className="text-muted">Payload</dt>
              <dd className="font-mono break-all" data-part="log-payload">{run.payload}</dd>
            </>
          )}
        </dl>
      </details>
    </li>
  );
}
