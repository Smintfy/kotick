// The state tree: every non-history state, the real active leaves, the previewed ones and which
// data a preview of each leaf would use.

import type { CSSProperties } from 'react';
import type { DataAvailability, Override, StateNodeInfo } from '../core/types';

interface StateTreeProps {
  nodes: readonly StateNodeInfo[];
  /** Names the tree for assistive technology, such as the instance label. */
  label: string;
  /** The real actor's active leaves. */
  active: ReadonlySet<string>;
  override: Override | undefined;
  data: DataAvailability;
  /** The leaf keyboard navigation is on; the only one in the tab order. */
  cursor: string | undefined;
  /** Child machines are listed but can't be previewed. */
  readOnly: boolean;
  onSelect(leaf: string): void;
}

export function StateTree(props: StateTreeProps) {
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
    return (
      <li role="treeitem" aria-level={depth + 1} aria-expanded="true" className="sv-group">
        <div className="sv-node" style={style} title={description}>
          <span className="sv-label">
            <span className="sv-key">{node.key}</span>
            {description && <span className="sv-description">{description}</span>}
          </span>
          <span className="sv-meta">
            {node.type === 'parallel' && <span className="sv-type">parallel</span>}
            {tags.map((tag) => (
              <span key={tag} className="sv-tag">
                {tag}
              </span>
            ))}
          </span>
        </div>
        <ul role="group">
          {(node.children ?? []).map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} tree={tree} />
          ))}
        </ul>
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
      <span className="sv-live" data-on={isActive || undefined} aria-hidden="true" />
      <span className="sv-label">
        <span className="sv-key">{node.key}</span>
        {description && <span className="sv-description">{description}</span>}
      </span>
      <span className="sv-meta">
        {node.type === 'final' && <span className="sv-type">final</span>}
        {tags.map((tag) => (
          <span key={tag} className="sv-tag">
            {tag}
          </span>
        ))}
        {requested && (
          <span className="sv-pin" aria-hidden="true">
            preview
          </span>
        )}
        {recorded && <DataMark kind="recorded" />}
        {fixture && <DataMark kind="fixture" />}
        {!recorded && !fixture && <DataMark kind="none" />}
      </span>
      <span className="sv-visually-hidden">, {status.join(', ')}</span>
    </li>
  );
}

const MARKS = {
  recorded: { text: 'R', title: 'Recorded context: the app has been in this state' },
  fixture: { text: 'F', title: 'Fixture context from defineFixtures()' },
  none: { text: '–', title: 'No recorded or fixture context; a preview uses the live context' },
} as const;

export function DataMark({ kind }: { kind: keyof typeof MARKS }) {
  return (
    <span className="sv-data" data-kind={kind} title={MARKS[kind].title} aria-hidden="true">
      {MARKS[kind].text}
    </span>
  );
}
