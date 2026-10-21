// The States section: the state tree, and buttons for the child machines.
// The tree shows each non-history state, the active and previewed leaves, and the data a preview of each leaf uses.
// A click on a compound or parallel state collapses or expands it.

import { useId, type CSSProperties } from 'react';
import type { DataAvailability, Override, RegistrySnapshot, StateNodeInfo } from '../types';
import type { InstanceEntry } from '../utils/model';
import { BUTTON, HINT, SECTION, SECTION_HEAD, SECTION_TITLE, TAG } from './classes';
import { ChevronIcon } from './icons';

interface StatesSectionProps {
  instance: InstanceEntry;
  nodes: readonly StateNodeInfo[];
  active: ReadonlySet<string>;
  /** The compound and parallel states whose children the tree hides, by node id. */
  collapsed: ReadonlySet<string>;
  cursor: string | undefined;
  canPreview: boolean;
  parentLabel: string | undefined;
  childInstances: InstanceEntry[];
  snapshot: RegistrySnapshot;
  data: DataAvailability;
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
      {props.nodes.length === 0 ? (
        <p className={HINT} data-part="hint">This machine has no states to list.</p>
      ) : (
        <StateTree
          nodes={props.nodes}
          label={`States of ${instance.label}`}
          active={props.active}
          override={props.snapshot.overrides[instance.key]}
          data={props.data}
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
  /** Names the tree for assistive technology, such as the instance label. */
  label: string;
  /** The real actor's active leaves. */
  active: ReadonlySet<string>;
  override: Override | undefined;
  data: DataAvailability;
  collapsed: ReadonlySet<string>;
  /** The leaf keyboard navigation is on; the only one in the tab order. */
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
  const style: CSSProperties & Record<`--${string}`, number> = { '--konat-depth': depth };
  const tags = Array.isArray(node.tags) ? node.tags : [];
  const description = node.description === '' ? undefined : node.description;

  if (node.type !== 'atomic' && node.type !== 'final') {
    const open = !tree.collapsed.has(node.id);

    return (
      <li role="treeitem" aria-level={depth + 1} aria-expanded={open} className="group/state" style={style}>
        <div
          className="flex cursor-pointer min-h-6 items-center gap-1.5 rounded-md py-0.5 pr-1.5 pl-[calc(6px+var(--konat-depth,0)*14px)] text-muted hover:bg-hover"
          data-part="node"
          title={description}
          onClick={() => tree.onToggle(node.id)}
        >
          <ChevronIcon
            size={12}
            className="flex-none text-muted [transition:transform_100ms_ease] group-aria-[expanded=false]/state:transform-[rotate(-90deg)] motion-reduce:[transition:none]"
          />
          <span className="grid min-w-0 flex-auto">
            <span className="truncate font-mono text-base" data-part="key">{node.key}</span>
            {description && <span className="truncate text-sm text-muted" data-part="description">{description}</span>}
          </span>
          <span className="flex flex-none items-center gap-1">
            {node.type === 'parallel' && <span className="text-sm text-muted" data-part="type">parallel</span>}
            {tags.map((tag) => (
              <span key={tag} className={TAG} data-part="tag">
                {tag}
              </span>
            ))}
          </span>
        </div>
        {open && (
          // A group's children hang from a guide under the middle of its chevron.
          <ul
            role="group"
            className="relative grid gap-px before:absolute before:inset-y-0 before:left-[calc(11.5px+var(--konat-depth)*14px)] before:w-px before:bg-guide"
          >
            {(node.children ?? []).map((child) => (
              <TreeNode key={child.id} node={child} depth={depth + 1} tree={tree} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const { active, override, data, cursor, readOnly, onSelect } = tree;
  const isActive = active.has(node.id);
  const requested = override?.requested.includes(node.id) === true;
  // Shown by the preview because its region was left alone: the real leaf, carried into the forced snapshot.
  const filled = !requested && override?.leaves.includes(node.id) === true;
  const recorded = data.recorded.has(node.id);
  const fixture = data.fixture.has(node.id);

  const status = [
    isActive && 'active',
    requested && 'previewed',
    filled && 'shown in the preview',
    recorded && 'recorded context',
    fixture && 'fixture',
    !recorded && !fixture && 'no recorded or fixture context',
  ].filter(Boolean);

  return (
    <li
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={requested}
      aria-disabled={readOnly || undefined}
      tabIndex={cursor === node.id ? 0 : -1}
      className="group/leaf flex cursor-pointer min-h-6 items-center gap-1.5 rounded-md py-0.5 pr-1.5 pl-[calc(6px+var(--konat-depth,0)*14px)] focus-visible:outline-offset-[-2px] aria-disabled:cursor-default aria-selected:bg-selected data-filled:bg-filled hover:not-aria-disabled:not-aria-selected:bg-hover"
      style={style}
      data-leaf={node.id}
      data-active={isActive || undefined}
      data-filled={filled || undefined}
      title={description}
      onClick={() => onSelect(node.id)}
    >
      <span className="flex flex-none gap-0.5">
        {recorded && <DataMark kind="recorded" />}
        {fixture && <DataMark kind="fixture" />}
        {!recorded && !fixture && <DataMark kind="none" />}
      </span>
      <span className="grid min-w-0 flex-auto">
        <span className="truncate font-mono text-base" data-part="key">{node.key}</span>
        {description && <span className="truncate text-sm text-muted" data-part="description">{description}</span>}
      </span>
      <span className="flex flex-none items-center gap-1">
        {node.type === 'final' && <span className="text-sm text-muted" data-part="type">final</span>}
        {tags.map((tag) => (
          <span key={tag} className={TAG} data-part="tag">
            {tag}
          </span>
        ))}
        {isActive && <span className="size-1.5 flex-none rounded-[50%] bg-live" title="Live state" aria-hidden="true" />}
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

function DataMark({ kind }: { kind: keyof typeof MARKS }) {
  return (
    <span className={MARKS[kind].className} data-kind={kind} title={MARKS[kind].title} aria-hidden="true">
      {MARKS[kind].text}
    </span>
  );
}
