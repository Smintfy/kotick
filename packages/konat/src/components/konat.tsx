import * as React from 'react';
import { createPortal } from 'react-dom';
import { getPageRegistry } from '../core/registry';
import { useIsomorphicLayoutEffect } from '../hooks/use-isomorphic-layout-effect';
import { overlayStyles } from '../styles.generated';
import type { KonatProps } from '../types';
import { createHost, type OverlayHost } from '../utils/host';
import { Overlay } from './overlay';

export function Konat(props: KonatProps): React.ReactNode {
  const registry = getPageRegistry();
  const { fixtures } = props;
  React.useEffect(() => (fixtures === undefined ? undefined : registry.loadFixtures(fixtures)), [registry, fixtures]);
  const host = useHost(props.portalTarget);

  return host && createPortal(<Overlay {...props} registry={registry} host={host} />, host.container);
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
