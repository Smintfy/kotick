// <StateViewer /> in development builds.
// It applies the page's deep link, registers fixtures, and renders the overlay into a shadow root.

import * as React from 'react';
import { createPortal } from 'react-dom';
import { getRegistry } from '../core/registry';
import type { FixtureSet, Registry } from '../core/types';
import { Overlay } from './components/Overlay';
import { readDeepLink, resolveUrlParam } from './deep-link';
import { useIsomorphicLayoutEffect } from './hooks';
import { createHost, type OverlayHost } from './host';
import type { FixturesInput, StateViewerProps } from './props';

export function StateViewer(props: StateViewerProps): React.ReactNode {
  const registry = getRegistry();
  useDeepLink(registry, resolveUrlParam(props.urlParam));
  useFixtures(registry, props.fixtures);
  const host = useHost(props.portalTarget);
  return host && createPortal(<Overlay {...props} registry={registry} host={host} />, host.container);
}

// Links applied per registry, so remounting the overlay (Fast Refresh of the component that renders it, a route
// change) doesn't bring back previews the user released.
const appliedLinks = new WeakMap<Registry, Set<string>>();

/**
 * Applies the URL's deep link. In an insertion effect, which React runs before every layout effect of the
 * commit: the app's hooks register in layout effects, so instances that mount along with the overlay are previewed
 * as they register and show the preview in their first paint. Earlier ones, like a connect()ed module-level
 * actor, are previewed at the registry's next microtask.
 */
function useDeepLink(registry: Registry, param: string): void {
  React.useInsertionEffect(() => {
    const search = window.location.search;
    let applied = appliedLinks.get(registry);
    if (!applied) {
      applied = new Set();
      appliedLinks.set(registry, applied);
    }
    const id = `${param}\n${search}`;
    if (applied.has(id)) return;
    applied.add(id);
    const targets = readDeepLink(search, param);
    if (targets.length > 0) registry.link(targets);
  }, [registry, param]);
}

// Sets already registered, so a loader that runs again (an inline arrow on a re-render, StrictMode) adds nothing new.
const registeredSets = new WeakMap<Registry, WeakSet<FixtureSet>>();

/**
 * Registers fixtures given directly or by a lazy loader. Previews made before they load pick them up.
 * In an insertion effect, like the deep link: then the registry expects the fixtures before the app's hooks register in
 * layout effects and the link previews them.
 * Thus, a linked preview that starts on the live context warns only if the fixtures don't give it context.
 */
function useFixtures(registry: Registry, input: FixturesInput | undefined): void {
  React.useInsertionEffect(() => {
    if (input === undefined) return;
    let current = true;
    // Ended when the load settles, not on cleanup: StrictMode and a new input start the next load after the cleanup,
    // and an end between them would give the held warnings too early.
    const done = registry.expectFixtures();
    void loadFixtures(input)
      .then((sets) => {
        // A newer input took over; its sets win.
        if (!current) return;
        let seen = registeredSets.get(registry);
        if (!seen) {
          seen = new WeakSet();
          registeredSets.set(registry, seen);
        }
        const fresh = sets.filter((set) => !seen.has(set));
        if (fresh.length === 0) return;
        for (const set of fresh) seen.add(set);
        registry.registerFixtures(fresh);
      })
      .finally(done);
    return () => {
      current = false;
    };
  }, [registry, input]);
}

/** The host element, appended to `target` or `document.body` on the client. Nothing renders on the server. */
function useHost(target: Element | ShadowRoot | undefined): OverlayHost | null {
  const [host, setHost] = React.useState<OverlayHost | null>(null);
  useIsomorphicLayoutEffect(() => {
    const created = createHost(target ?? document.body ?? document.documentElement);
    setHost(created);
    return () => {
      created.remove();
      setHost((current) => (current === created ? null : current));
    };
  }, [target]);
  return host;
}

/**
 * The sets `<StateViewer fixtures>` gives directly or through a loader, such as `() => import('@/debug/fixtures')`.
 * None, with a warning, when it gives something else or the loader fails.
 */
export async function loadFixtures(input: FixturesInput): Promise<FixtureSet[]> {
  let result: unknown;
  try {
    result = typeof input === 'function' ? await input() : input;
  } catch (error) {
    console.warn('[state-viewer] The fixtures loader failed.', error);
    return [];
  }
  // A module namespace from import(), whose default export is the sets.
  if (!Array.isArray(result) && typeof result === 'object' && result !== null && 'default' in result) {
    result = (result as { default: unknown }).default;
  }
  if (!Array.isArray(result)) {
    console.warn(
      '[state-viewer] Expected fixtures to be an array of sets from defineFixtures(), ' +
        'or a module whose default export is one.',
    );
    return [];
  }
  const sets = result.filter(isFixtureSet);
  if (sets.length < result.length) {
    console.warn('[state-viewer] Ignoring fixture entries that are not sets from defineFixtures().');
  }
  return sets;
}

function isFixtureSet(value: unknown): value is FixtureSet {
  if (typeof value !== 'object' || value === null) return false;
  const { machineId, states } = value as Partial<FixtureSet>;
  return typeof machineId === 'string' && typeof states === 'object' && states !== null;
}
