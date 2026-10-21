import type { FixtureSet } from '../core/types';

export type Position = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type Theme = 'system' | 'light' | 'dark';

/** What a fixtures loader gives: the sets, or a module whose default export is them, as `import()` resolves. */
export type FixturesResult = readonly FixtureSet[] | { default: readonly FixtureSet[] };

/** Sets from `defineFixtures`, or a loader for them such as `() => import('./debug/fixtures')`. */
export type FixturesInput = readonly FixtureSet[] | (() => FixturesResult | PromiseLike<FixturesResult>);

export interface KonatProps {
  /** Corner for the toolbar and panel until the user moves them. Defaults to `'bottom-right'`. */
  position?: Position;
  /** Whether the panel starts open, until the user opens or closes it. Defaults to `false`. */
  defaultOpen?: boolean;
  /** Defaults to `'system'`. */
  theme?: Theme;
  /** Toggles the panel from anywhere, such as `'alt+s'` (the default) or `'ctrl+shift+d'`; `false` turns it off. */
  shortcut?: string | false;
  /** Fixture sets, or a loader for them, which becomes its own chunk. Wrap it in a dev check to drop it from builds. */
  fixtures?: FixturesInput;
  /** Where the overlay's host element is appended. Defaults to `document.body`. */
  portalTarget?: Element | ShadowRoot;
}
