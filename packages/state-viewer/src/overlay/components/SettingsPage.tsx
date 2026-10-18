// The settings page: the corner of the bubble and the panel, and the keyboard shortcuts.

import { useId } from 'react';
import type { Position } from '../props';

const CORNERS: readonly { position: Position; label: string }[] = [
  { position: 'top-left', label: 'Top left' },
  { position: 'top-right', label: 'Top right' },
  { position: 'bottom-left', label: 'Bottom left' },
  { position: 'bottom-right', label: 'Bottom right' },
];

const PAGE_SHORTCUTS: readonly { keys: string[]; action: string }[] = [
  { keys: ['↑', '↓'], action: 'Previous or next row' },
  { keys: ['Home', 'End'], action: 'First or last row' },
  { keys: ['Enter'], action: 'Preview or release the state' },
  { keys: ['Esc'], action: 'Release all previews' },
  { keys: ['[', ']'], action: 'Previous or next machine' },
];

interface SettingsPageProps {
  position: Position;
  /** The toggle shortcut, such as 'Alt+S'. Undefined while the shortcut is off. */
  shortcutLabel: string | undefined;
  onPosition(position: Position): void;
}

export function SettingsPage({ position, shortcutLabel, onPosition }: SettingsPageProps) {
  const cornerId = useId();
  const shortcutsId = useId();
  const name = useId();
  const shortcuts = shortcutLabel
    ? [{ keys: [shortcutLabel], action: 'Open or close the panel' }, ...PAGE_SHORTCUTS]
    : PAGE_SHORTCUTS;

  return (
    <div className="sv-body">
      <section className="sv-section" aria-labelledby={cornerId}>
        <div className="sv-section-head">
          <h3 className="sv-section-title" id={cornerId}>
            Corner
          </h3>
        </div>
        <div className="sv-corners" role="radiogroup" aria-labelledby={cornerId}>
          {CORNERS.map((corner) => (
            <label key={corner.position} className="sv-corner">
              <input
                type="radio"
                name={name}
                value={corner.position}
                checked={position === corner.position}
                onChange={() => onPosition(corner.position)}
              />
              <span>{corner.label}</span>
            </label>
          ))}
        </div>
      </section>
      <section className="sv-section" aria-labelledby={shortcutsId}>
        <div className="sv-section-head">
          <h3 className="sv-section-title" id={shortcutsId}>
            Shortcuts
          </h3>
        </div>
        <ul className="sv-shortcuts" aria-labelledby={shortcutsId}>
          {shortcuts.map(({ keys, action }) => (
            <li key={action} className="sv-shortcut">
              <span>{action}</span>
              <span className="sv-keys">
                {keys.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
