// The context section: a read-only JSON viewer, and while previewing, which source the context came from
// with a switcher for it.

import { useId, useState } from 'react';
import type { DataSource, Override } from '../../core/types';
import { inspect } from '../format';
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
    <section className="sv-section" aria-labelledby={titleId}>
      <div className="sv-section-head">
        <h3 className="sv-section-title" id={titleId}>
          Context
        </h3>
        {override ? (
          <div className="sv-segmented" role="radiogroup" aria-label="Context source">
            {SOURCES.map(({ source, label, missing }) => {
              const enabled = available[source] || override.source === source;
              return (
                <label key={source} className="sv-segment" title={enabled ? undefined : missing}>
                  <input
                    type="radio"
                    name={name}
                    value={source}
                    checked={override.source === source}
                    disabled={!enabled}
                    onChange={() => onSource(source)}
                  />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
        ) : (
          <span className="sv-source">Live</span>
        )}
      </div>
      {fellBack && (
        <p className="sv-warning" data-part="warning">No recording or fixture for this state, so the preview uses live context.</p>
      )}
      <JsonView value={context} />
    </section>
  );
}

/** Entries shown per object before "… n more", so a huge context doesn't stall the panel. */
const ENTRY_LIMIT = 100;

function JsonView({ value }: { value: unknown }) {
  const inspected = inspect(value);
  return (
    <div className="sv-json" data-testid="sv-json">
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
        <div className="sv-json-row sv-json-special" data-part="json-row">… {entries.length - ENTRY_LIMIT} more</div>
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
      <span className="sv-json-key">{name}</span>:{' '}
    </>
  );
  const circular = typeof value === 'object' && value !== null && ancestors.includes(value);
  const inspected = circular ? undefined : inspect(value);

  if (!inspected || inspected.kind === 'leaf' || inspected.size === 0) {
    const text = !inspected ? '[Circular]' : inspected.kind === 'leaf' ? inspected.text : inspected.summary;
    const type = !inspected ? 'special' : inspected.kind === 'leaf' ? inspected.type : 'summary';
    return (
      <div className="sv-json-row" data-part="json-row">
        {label}
        <span className={`sv-json-${type}`}>{text === 'Array(0)' ? '[]' : text}</span>
      </div>
    );
  }

  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <ChevronIcon size={10} className="sv-json-chevron" />
        {label}
        <span className="sv-json-summary">{inspected.summary}</span>
      </summary>
      {open && (
        <div className="sv-json-children">
          <Entries value={value} entries={inspected.entries()} depth={depth + 1} ancestors={ancestors} />
        </div>
      )}
    </details>
  );
}
