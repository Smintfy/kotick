// <StateViewer /> in development builds.
// It applies the page's deep link, registers fixtures, and renders the overlay into a shadow root.

import * as React from 'react';
import { createPortal } from 'react-dom';
import { getPageRegistry } from '../core/registry';
import type { FixtureSet, Registry } from '../core/types';
import { Overlay } from './components/Overlay';
import { readDeepLink, resolveUrlParam } from './deep-link';
import { useIsomorphicLayoutEffect } from './hooks';
import { createHost, type OverlayHost } from './host';
import type { FixturesInput, StateViewerProps } from './props';
import { overlayStyles } from './styles.generated';

export function StateViewer(props: StateViewerProps): React.ReactNode {
  const registry = getPageRegistry();
  useDeepLink(registry, resolveUrlParam(props.urlParam));
  useFixtures(registry, props.fixtures);
  const host = useHost(props.portalTarget);

  return host && createPortal(<Overlay {...props} registry={registry} host={host} />, host.container);
}

// Links applied per registry, so remounting the overlay (Fast Refresh of the component that renders it, a route
// change) doesn't bring back previews the user released.
const appliedLinks = new WeakMap<Registry, Set<string>>();

function useDeepLink(registry: Registry, param: string): void {
  // React runs the insertion effects of a commit before all its layout effects, where the app's hooks register.
  // So instances that mount with the overlay are previewed as they register, and their first paint shows the preview.
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

    if (targets.length > 0) registry.applyDeepLink(targets);
  }, [registry, param]);
}

// Sets already registered, so a loader that runs again (an inline arrow on a re-render, StrictMode) adds nothing new.
const registeredSets = new WeakMap<Registry, WeakSet<FixtureSet>>();

function useFixtures(registry: Registry, input: FixturesInput | undefined): void {
  // Like the deep link, this insertion effect runs before the app's hooks register in layout effects.
  // So the registry expects the fixtures before the link previews the instances.
  React.useInsertionEffect(() => {
    if (input === undefined) return;
    let current = true;
    // Ended when the load settles, not on cleanup: StrictMode and a new input start the next load after the cleanup,
    // and an end between them would give the held warnings too early.
    const endLoad = registry.startFixtureLoad();
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
      .finally(endLoad);

    return () => {
      current = false;
    };
  }, [registry, input]);
}

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
  // Fast Refresh renders this again after the style watcher writes new CSS, but the host stays, so its <style> changes.
  const css = overlayStyles();
  useIsomorphicLayoutEffect(() => {
    if (host && host.style.textContent !== css) host.style.textContent = css;
  }, [host, css]);

  return host;
}

/** Whether the fixtures prop is a loader. A function of another window is one too. */
function isLoader(input: FixturesInput): input is Exclude<FixturesInput, readonly FixtureSet[]> {
  return typeof input === 'function';
}

async function loadFixtures(input: FixturesInput): Promise<FixtureSet[]> {
  let result: unknown;

  try {
    result = isLoader(input) ? await input() : input;
  } catch (error) {
    console.warn('[state-viewer] The fixtures loader failed.', error);

    return [];
  }

  if (hasDefaultExport(result)) result = result.default;

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

/** A module namespace, as a loader that returns `import()` resolves to. */
function hasDefaultExport(value: unknown): value is { default: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'default' in value;
}

function isFixtureSet(value: unknown): value is FixtureSet {
  return (
    typeof value === 'object' &&
    value !== null &&
    'machineId' in value &&
    typeof value.machineId === 'string' &&
    'states' in value &&
    typeof value.states === 'object' &&
    value.states !== null
  );
}
