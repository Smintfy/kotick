import { useId } from 'react';
import type { Position } from '../types';
import { isApple } from '../utils/shortcut';
import { BODY, SECTION, SECTION_HEAD, SECTION_TITLE } from './classes';

const CORNERS: readonly { position: Position; label: string }[] = [
  { position: 'top-left', label: 'Top left' },
  { position: 'top-right', label: 'Top right' },
  { position: 'bottom-left', label: 'Bottom left' },
  { position: 'bottom-right', label: 'Bottom right' },
];

/** A function, so the module reads the platform in the browser, not when a server imports it. */
const pageShortcuts = (): readonly { keys: string[]; action: string }[] => [
  { keys: ['↑', '↓'], action: 'Previous or next row' },
  { keys: isApple() ? ['⌘↑', '⌘↓'] : ['Home', 'End'], action: 'First or last row' },
  { keys: ['Enter'], action: 'Preview or release the state' },
  { keys: ['Esc'], action: 'Release all previews' },
  { keys: ['[', ']'], action: 'Previous or next machine' },
];

interface SettingsPageProps {
  position: Position;
  /** Undefined while the shortcut is off. */
  shortcutLabel: string | undefined;
  onPosition(position: Position): void;
}

export function SettingsPage({ position, shortcutLabel, onPosition }: SettingsPageProps) {
  const cornerId = useId();
  const shortcutsId = useId();
  const name = useId();

  const shortcuts = shortcutLabel
    ? [{ keys: [shortcutLabel], action: 'Open or close the panel' }, ...pageShortcuts()]
    : pageShortcuts();

  return (
    <div className={BODY}>
      <section className={SECTION} aria-labelledby={cornerId}>
        <div className={SECTION_HEAD}>
          <h3 className={SECTION_TITLE} id={cornerId}>
            Corner
          </h3>
        </div>
        <div className="grid grid-cols-[1fr_1fr] gap-1 px-1.5 pb-1" role="radiogroup" aria-labelledby={cornerId}>
          {CORNERS.map((corner) => (
            <label key={corner.position} className="relative block">
              <input
                className="peer absolute inset-0 m-0 size-full cursor-pointer opacity-0"
                type="radio"
                name={name}
                value={corner.position}
                checked={position === corner.position}
                onChange={() => onPosition(corner.position)}
              />
              <span className="grid h-7 place-items-center rounded-md bg-surface text-base text-muted peer-checked:bg-segment-on peer-checked:text-fg peer-checked:[box-shadow:var(--konat-segment-shadow)] peer-hover:text-fg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-focus">
                {corner.label}
              </span>
            </label>
          ))}
        </div>
      </section>
      <section className={SECTION} aria-labelledby={shortcutsId}>
        <div className={SECTION_HEAD}>
          <h3 className={SECTION_TITLE} id={shortcutsId}>
            Shortcuts
          </h3>
        </div>
        <ul className="grid gap-0.5 px-1.5 pb-1" aria-labelledby={shortcutsId}>
          {shortcuts.map(({ keys, action }) => (
            <li key={action} className="flex min-h-6 items-center justify-between gap-2 text-base text-muted">
              <span>{action}</span>
              <span className="flex flex-none gap-0.75 text-fg">
                {keys.map((key) => (
                  <kbd
                    key={key}
                    className="h-4 min-w-4 rounded-sm bg-chip px-1 text-center font-[inherit] text-sm leading-4"
                  >
                    {key}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
