// The context section: a read-only JSON viewer, and while previewing, which source the context came from
// with a switcher for it.

import { useId, useState } from 'react';
import type { DataSource, Override } from '../../core/types';
import { inspect } from '../format';
import { SECTION, SECTION_HEAD, SECTION_TITLE } from './classes';
import { ChevronIcon } from './icons';

const SOURCES: readonly { source: DataSource; label: string; missing: string }[] = [
  { source: 'recorded', label: 'Recorded', missing: 'Nothing recorded for this state yet' },
  { source: 'fixture', label: 'Fixture', missing: 'No fixture for this state' },
  { source: 'live', label: 'Live', missing: '' },
];

interface ContextViewProps {
  context: unknown;
  /** Set while the instance is previewed. */
  override: Override | undefined;
  /** Which sources have context for the preview's leaves. */
  available: Readonly<Record<DataSource, boolean>>;
  onSource(source: DataSource): void;
}

export function ContextView({ context, override, available, onSource }: ContextViewProps) {
  const titleId = useId();
  const name = useId();
  const fellBack = override?.source === 'live' && !available.recorded && !available.fixture;

  return (
    <section className={SECTION} aria-labelledby={titleId}>
      <div className={SECTION_HEAD}>
        <h3 className={SECTION_TITLE} id={titleId}>
          Context
        </h3>
        {override ? (
          <div className="inline-flex rounded-[7px] bg-surface p-0.5" role="radiogroup" aria-label="Context source">
            {SOURCES.map(({ source, label, missing }) => {
              const enabled = available[source] || override.source === source;

              return (
                <label key={source} className="relative inline-flex" title={enabled ? undefined : missing}>
                  <input
                    className="peer absolute inset-0 m-0 size-full cursor-pointer opacity-0 disabled:cursor-default"
                    type="radio"
                    name={name}
                    value={source}
                    checked={override.source === source}
                    disabled={!enabled}
                    onChange={() => onSource(source)}
                  />
                  <span className="rounded-[5px] px-2 text-base leading-5 text-muted peer-checked:bg-segment-on peer-checked:text-fg peer-checked:[box-shadow:var(--sv-segment-shadow)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-focus peer-disabled:opacity-45">
                    {label}
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <span className="text-base text-muted">Live</span>
        )}
      </div>
      {fellBack && (
        <p className="mb-1.5 px-1.5 text-base text-warn" data-part="warning">No recording or fixture for this state, so the preview uses live context.</p>
      )}
      <JsonView value={context} />
    </section>
  );
}

/** The class of a value by its type. */
const VALUE_CLASSES = {
  string: 'whitespace-pre text-json-string',
  number: 'text-json-number',
  boolean: 'text-json-literal',
  null: 'text-json-literal',
  undefined: 'text-json-literal',
  special: 'text-muted italic',
  summary: 'text-muted',
} as const;

/** Entries shown per object before "… n more", so a huge context doesn't stall the panel. */
const ENTRY_LIMIT = 100;

function JsonView({ value }: { value: unknown }) {
  const inspected = inspect(value);

  return (
    <div
      className="max-h-65 overflow-auto rounded-lg bg-surface px-2 py-1.5 font-mono text-base leading-normal whitespace-nowrap"
      data-testid="sv-json"
    >
      {inspected.kind === 'branch' && inspected.size > 0 ? (
        <Entries value={value} entries={inspected.entries()} depth={0} ancestors={[]} />
      ) : (
        <JsonEntry value={value} depth={0} ancestors={[]} />
      )}
    </div>
  );
}

function Entries(props: { value: unknown; entries: [string, unknown][]; depth: number; ancestors: unknown[] }) {
  const { entries, depth } = props;
  const ancestors = [...props.ancestors, props.value];

  return (
    <>
      {entries.slice(0, ENTRY_LIMIT).map(([name, item], index) => (
        <JsonEntry key={index} name={name} value={item} depth={depth} ancestors={ancestors} />
      ))}
      {entries.length > ENTRY_LIMIT && (
        <div className="pl-3.5 text-muted italic" data-part="json-row">… {entries.length - ENTRY_LIMIT} more</div>
      )}
    </>
  );
}

interface JsonEntryProps {
  name?: string;
  value: unknown;
  depth: number;
  /** Objects above this one, to show a cycle rather than follow it. */
  ancestors: unknown[];
}

function JsonEntry({ name, value, depth, ancestors }: JsonEntryProps) {
  // Collapsed branches render no children, so a large context costs only what's expanded.
  const [open, setOpen] = useState(depth < 2);

  const label = name !== undefined && (
    <>
      <span className="text-json-key">{name}</span>:{' '}
    </>
  );

  const circular = typeof value === 'object' && value !== null && ancestors.includes(value);
  const inspected = circular ? undefined : inspect(value);

  if (!inspected || inspected.kind === 'leaf' || inspected.size === 0) {
    const text = !inspected ? '[Circular]' : inspected.kind === 'leaf' ? inspected.text : inspected.summary;
    const type = !inspected ? 'special' : inspected.kind === 'leaf' ? inspected.type : 'summary';

    return (
      // A row without a chevron starts where the keys after a chevron start.
      <div className="pl-3.5" data-part="json-row">
        {label}
        <span className={VALUE_CLASSES[type]}>{text === 'Array(0)' ? '[]' : text}</span>
      </div>
    );
  }

  return (
    <details className="group/json" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <ChevronIcon
          size={10}
          className="mr-1 align-[-1px] text-muted [transition:transform_100ms_ease] group-not-open/json:transform-[rotate(-90deg)] motion-reduce:[transition:none]"
        />
        {label}
        <span className="text-muted">{inspected.summary}</span>
      </summary>
      {open && (
        <div className="pl-3.5">
          <Entries value={value} entries={inspected.entries()} depth={depth + 1} ancestors={ancestors} />
        </div>
      )}
    </details>
  );
}
