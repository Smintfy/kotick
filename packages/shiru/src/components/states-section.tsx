import { useId, type CSSProperties } from 'react';
import type { DataAvailability, Override, RegistrySnapshot, StateNodeInfo } from '../types';
import type { InstanceEntry } from '../utils/model';
import { BUTTON, HINT, SECTION, SECTION_HEAD, SECTION_TITLE, WARNING } from './classes';
import { ChevronIcon } from './icons';

interface StatesSectionProps {
  instance: InstanceEntry;
  nodes: readonly StateNodeInfo[];
  /** The compound and parallel states whose children the tree hides, by node id. */
  collapsed: ReadonlySet<string>;
  cursor: string | undefined;
  canPreview: boolean;
  parentLabel: string | undefined;
  childInstances: InstanceEntry[];
  snapshot: RegistrySnapshot;
  data: DataAvailability;
  /** The leaves whose preview can't get data. Their rows are disabled, unless the leaf is previewed. */
  noData: ReadonlySet<string>;
  warnings: readonly string[];
  onRelease: (() => void) | undefined;
  onSelectLeaf(leaf: string): void;
  onToggleGroup(id: string): void;
  onSelectInstance(instanceKey: string): void;
}

export function StatesSection(props: StatesSectionProps) {
  const titleId = useId();
  const { instance, canPreview, parentLabel, childInstances } = props;

  return (
    <section className={SECTION} aria-labelledby={titleId}>
      <div className={SECTION_HEAD}>
        <h3 className={SECTION_TITLE} id={titleId}>
          States
        </h3>
        {props.onRelease && (
          <button type="button" className={BUTTON} onClick={props.onRelease}>
            Release
          </button>
        )}
      </div>
      {!canPreview && (
        <p className={HINT} data-part="hint">
          {parentLabel ? `Child of ${parentLabel}. ` : ''}Child machines are listed read-only.
        </p>
      )}
      {props.warnings.map((warning) => (
        <p key={warning} className={WARNING} data-part="states-warning">
          {warning}
        </p>
      ))}
      {props.nodes.length === 0 ? (
        <p className={HINT} data-part="hint">This machine has no states to list.</p>
      ) : (
        <StateTree
          nodes={props.nodes}
          label={`States of ${instance.label}`}
          override={props.snapshot.overrides[instance.key]}
          data={props.data}
          noData={props.noData}
          collapsed={props.collapsed}
          cursor={props.cursor}
          readOnly={!canPreview}
          onSelect={props.onSelectLeaf}
          onToggle={props.onToggleGroup}
        />
      )}
      {childInstances.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1 px-1.5" data-part="children">
          <span className="text-base text-muted" data-part="hint">
            Children:
          </span>
          {childInstances.map((child) => (
            <button
              key={child.key}
              type="button"
              className="h-5 flex-none cursor-pointer rounded-[5px] bg-surface px-1.5 py-0 font-mono text-sm whitespace-nowrap text-fg enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-45"
              onClick={() => props.onSelectInstance(child.key)}
            >
              {child.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

interface StateTreeProps {
  nodes: readonly StateNodeInfo[];
  label: string;
  override: Override | undefined;
  data: DataAvailability;
  noData: ReadonlySet<string>;
  collapsed: ReadonlySet<string>;
  cursor: string | undefined;
  readOnly: boolean;
  onSelect(leaf: string): void;
  onToggle(id: string): void;
}

function StateTree(props: StateTreeProps) {
  return (
    <ul
      role="tree"
      aria-label={props.label}
      aria-multiselectable="true"
      className="grid gap-px [[data-part=hint]+&]:mt-1.5"
    >
      {props.nodes.map((node) => (
        <TreeNode key={node.id} node={node} depth={0} tree={props} />
      ))}
    </ul>
  );
}

function TreeNode({ node, depth, tree }: { node: StateNodeInfo; depth: number; tree: StateTreeProps }) {
  const style: CSSProperties & Record<`--${string}`, number> = { '--shiru-depth': depth };

  if (node.type !== 'atomic' && node.type !== 'final') {
    const open = !tree.collapsed.has(node.id);

    return (
      <li role="treeitem" aria-level={depth + 1} aria-expanded={open} className="group/state" style={style}>
        <div
          className="flex cursor-pointer min-h-6 items-center gap-1.5 rounded-md py-0.5 pr-1.5 pl-[calc(6px+var(--shiru-depth,0)*14px)] text-muted hover:bg-hover"
          data-part="node"
          onClick={() => tree.onToggle(node.id)}
        >
          <ChevronIcon
            size={12}
            className="flex-none text-muted [transition:transform_100ms_ease] group-aria-[expanded=false]/state:transform-[rotate(-90deg)] motion-reduce:[transition:none]"
          />
          <span className="min-w-0 flex-auto truncate font-mono text-base" data-part="key">{node.key}</span>
        </div>
        {open && (
          // A group's children hang from a guide under the middle of its chevron.
          <ul
            role="group"
            className="relative grid gap-px before:absolute before:inset-y-0 before:left-[calc(11.5px+var(--shiru-depth)*14px)] before:w-px before:bg-guide"
          >
            {(node.children ?? []).map((child) => (
              <TreeNode key={child.id} node={child} depth={depth + 1} tree={tree} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const { override, data, cursor, readOnly, onSelect } = tree;
  const requested = override?.requested.includes(node.id) === true;
  const filled = override?.filled.includes(node.id) === true;
  const recorded = data.recorded.has(node.id);
  const fixture = data.fixture.has(node.id);
  const noData = tree.noData.has(node.id);
  const unavailable = noData && !requested;

  const status = [
    requested && 'previewed',
    filled && 'shown in the preview',
    recorded && 'recorded context',
    fixture && 'fixture',
    !recorded && !fixture && 'no recorded or fixture context',
    noData && "can't be previewed",
  ].filter(Boolean);

  // The key starts 24px in, where the key of a group starts after its 12px chevron.
  return (
    <li
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={requested}
      aria-disabled={readOnly || unavailable || undefined}
      tabIndex={cursor === node.id ? 0 : -1}
      className="group/leaf flex cursor-pointer min-h-6 items-center gap-1.5 rounded-md py-0.5 pr-1.5 pl-[calc(24px+var(--shiru-depth,0)*14px)] focus-visible:outline-offset-[-2px] aria-disabled:cursor-default aria-selected:bg-selected data-filled:bg-filled data-unavailable:opacity-45 hover:not-aria-disabled:not-aria-selected:bg-hover"
      style={style}
      data-leaf={node.id}
      data-filled={filled || undefined}
      data-unavailable={unavailable || undefined}
      onClick={() => onSelect(node.id)}
    >
      <span className="min-w-0 flex-auto truncate font-mono text-base" data-part="key">{node.key}</span>
      <span className="flex flex-none gap-0.5">
        {recorded && <DataMark kind="recorded" />}
        {fixture && <DataMark kind="fixture" />}
        {!recorded && !fixture && <DataMark kind="none" title={noData ? NO_DATA_TITLE : undefined} />}
      </span>
      <span className="visually-hidden" data-part="leaf-status">, {status.join(', ')}</span>
    </li>
  );
}

const MARKS = {
  recorded: {
    text: 'R',
    title: 'Recorded context: the app has been in this state',
    className:
      'inline-grid size-3.5 place-items-center rounded-xs bg-recorded-soft text-2xs leading-none font-bold text-recorded group-aria-selected/leaf:bg-recorded-solid group-aria-selected/leaf:text-white',
  },
  fixture: {
    text: 'F',
    title: 'Fixture context from defineFixtures()',
    className:
      'inline-grid size-3.5 place-items-center rounded-xs bg-fixture-soft text-2xs leading-none font-bold text-fixture group-aria-selected/leaf:bg-fixture-solid group-aria-selected/leaf:text-white',
  },
  // On a selected leaf, the dashed border is muted, because the chip gray is too close to the selected gray.
  none: {
    text: '–',
    title: 'No recorded or fixture context; a preview uses the live context',
    className:
      'inline-grid size-3.5 place-items-center rounded-xs border border-dashed border-chip text-2xs leading-none font-bold text-muted group-aria-selected/leaf:border-muted',
  },
} as const;

// The title of the none mark above is true only for a leaf that the live context fits.
const NO_DATA_TITLE =
  "No recorded or fixture context, so this state can't be previewed yet. Visit it in the app, or add it to defineFixtures().";

function DataMark({ kind, title = MARKS[kind].title }: { kind: keyof typeof MARKS; title?: string }) {
  return (
    <span className={MARKS[kind].className} data-kind={kind} title={title} aria-hidden="true">
      {MARKS[kind].text}
    </span>
  );
}
