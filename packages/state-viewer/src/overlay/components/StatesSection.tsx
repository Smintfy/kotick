// The States section: the state tree, and buttons for the child machines.
// The tree shows each non-history state, the active and previewed leaves, and the data a preview of each leaf uses.
// A click on a compound or parallel state collapses or expands it.

import { useId, type CSSProperties } from 'react';
import type { DataAvailability, Override, RegistrySnapshot, StateNodeInfo } from '../../core/types';
import type { InstanceEntry } from '../model';
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
    <section className="sv-section" aria-labelledby={titleId}>
      <div className="sv-section-head">
        <h3 className="sv-section-title" id={titleId}>
          States
        </h3>
        {props.onRelease && (
          <button type="button" className="sv-button" onClick={props.onRelease}>
            Release
          </button>
        )}
      </div>
      {!canPreview && (
        <p className="sv-hint" data-part="hint">
          {parentLabel ? `Child of ${parentLabel}. ` : ''}Child machines are listed read-only.
        </p>
      )}
      {props.nodes.length === 0 ? (
        <p className="sv-hint" data-part="hint">This machine has no states to list.</p>
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
        <div className="sv-children" data-part="children">
          <span className="sv-hint" data-part="hint">Children:</span>
          {childInstances.map((child) => (
            <button
              key={child.key}
              type="button"
              className="sv-button"
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
    <ul role="tree" aria-label={props.label} aria-multiselectable="true" className="sv-tree">
      {props.nodes.map((node) => (
        <TreeNode key={node.id} node={node} depth={0} tree={props} />
      ))}
    </ul>
  );
}

function TreeNode({ node, depth, tree }: { node: StateNodeInfo; depth: number; tree: StateTreeProps }) {
  const style = { '--sv-depth': depth } as CSSProperties;
  const tags = Array.isArray(node.tags) ? node.tags : [];
  const description = typeof node.description === 'string' && node.description !== '' ? node.description : undefined;

  if (node.type !== 'atomic' && node.type !== 'final') {
    const open = !tree.collapsed.has(node.id);
    return (
      <li role="treeitem" aria-level={depth + 1} aria-expanded={open} className="sv-group" style={style}>
        <div className="sv-node" data-part="node" title={description} onClick={() => tree.onToggle(node.id)}>
          <ChevronIcon size={12} className="sv-chevron" />
          <span className="sv-label">
            <span className="sv-key" data-part="key">{node.key}</span>
            {description && <span className="sv-description" data-part="description">{description}</span>}
          </span>
          <span className="sv-meta">
            {node.type === 'parallel' && <span className="sv-type" data-part="type">parallel</span>}
            {tags.map((tag) => (
              <span key={tag} className="sv-tag" data-part="tag">
                {tag}
              </span>
            ))}
          </span>
        </div>
        {open && (
          <ul role="group">
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
      className="sv-node sv-leaf"
      style={style}
      data-leaf={node.id}
      data-active={isActive || undefined}
      data-filled={filled || undefined}
      title={description}
      onClick={() => onSelect(node.id)}
    >
      <span className="sv-marks">
        {recorded && <DataMark kind="recorded" />}
        {fixture && <DataMark kind="fixture" />}
        {!recorded && !fixture && <DataMark kind="none" />}
      </span>
      <span className="sv-label">
        <span className="sv-key" data-part="key">{node.key}</span>
        {description && <span className="sv-description" data-part="description">{description}</span>}
      </span>
      <span className="sv-meta">
        {node.type === 'final' && <span className="sv-type" data-part="type">final</span>}
        {tags.map((tag) => (
          <span key={tag} className="sv-tag" data-part="tag">
            {tag}
          </span>
        ))}
        {isActive && <span className="sv-live" title="Live state" aria-hidden="true" />}
      </span>
      <span className="sv-visually-hidden" data-part="leaf-status">, {status.join(', ')}</span>
    </li>
  );
}

const MARKS = {
  recorded: { text: 'R', title: 'Recorded context: the app has been in this state' },
  fixture: { text: 'F', title: 'Fixture context from defineFixtures()' },
  none: { text: '–', title: 'No recorded or fixture context; a preview uses the live context' },
} as const;

function DataMark({ kind }: { kind: keyof typeof MARKS }) {
  return (
    <span className="sv-data" data-kind={kind} title={MARKS[kind].title} aria-hidden="true">
      {MARKS[kind].text}
    </span>
  );
}
