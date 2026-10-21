// <Konat /> in development builds.
// It registers fixtures and renders the overlay into a shadow root.

import * as React from 'react';
import { createPortal } from 'react-dom';
import { getPageRegistry } from '../core/registry';
import type { FixtureSet, Registry } from '../core/types';
import { Overlay } from './components/Overlay';
import { useIsomorphicLayoutEffect } from './hooks';
import { createHost, type OverlayHost } from './host';
import type { FixturesInput, KonatProps } from './props';
import { overlayStyles } from './styles.generated';

export function Konat(props: KonatProps): React.ReactNode {
  const registry = getPageRegistry();
  useFixtures(registry, props.fixtures);
  const host = useHost(props.portalTarget);

  return host && createPortal(<Overlay {...props} registry={registry} host={host} />, host.container);
}

// Sets already registered, so a loader that runs again (an inline arrow on a re-render, StrictMode) adds nothing new.
const registeredSets = new WeakMap<Registry, WeakSet<FixtureSet>>();

function useFixtures(registry: Registry, input: FixturesInput | undefined): void {
  // An insertion effect, because StrictMode doesn't run it a second time.
  // So the loader runs once when the overlay mounts, and its warnings show once.
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
    console.warn('[konat] The fixtures loader failed.', error);

    return [];
  }

  if (hasDefaultExport(result)) result = result.default;

  if (!Array.isArray(result)) {
    console.warn(
      '[konat] Expected fixtures to be an array of sets from defineFixtures(), ' +
        'or a module whose default export is one.',
    );

    return [];
  }

  const sets = result.filter(isFixtureSet);

  if (sets.length < result.length) {
    console.warn('[konat] Ignoring fixture entries that are not sets from defineFixtures().');
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
