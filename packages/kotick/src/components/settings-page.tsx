import { useId } from 'react';
import { isApple } from '../utils/shortcut';
import { BODY, SECTION, SECTION_HEAD, SECTION_TITLE } from './classes';

/** A function, so the module reads the platform in the browser, not when a server imports it. */
const pageShortcuts = (): readonly { keys: string[]; action: string }[] => [
  { keys: ['↑', '↓'], action: 'Previous or next row' },
  { keys: isApple() ? ['⌘↑', '⌘↓'] : ['Home', 'End'], action: 'First or last row' },
  { keys: ['Enter'], action: 'Preview or release the state' },
  { keys: ['Esc'], action: 'Release all previews' },
  { keys: ['[', ']'], action: 'Previous or next machine' },
];

interface SettingsPageProps {
  /** Undefined while the shortcut is off. */
  shortcutLabel: string | undefined;
}

export function SettingsPage({ shortcutLabel }: SettingsPageProps) {
  const shortcutsId = useId();

  const shortcuts = shortcutLabel
    ? [{ keys: [shortcutLabel], action: 'Open or close the panel' }, ...pageShortcuts()]
    : pageShortcuts();

  return (
    <div className={BODY}>
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
