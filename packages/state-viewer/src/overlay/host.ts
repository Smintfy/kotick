// The overlay's host element (R20, §10.6): a <div data-state-viewer-root> with an open shadow root holding the styles
// and the container React renders the overlay into.

import { STYLES } from './styles';

export const HOST_ATTRIBUTE = 'data-state-viewer-root';

export interface OverlayHost {
  host: HTMLElement;
  shadow: ShadowRoot;
  /** Where the overlay is rendered, inside the shadow root. */
  container: HTMLElement;
  remove(): void;
}

export function createHost(target: Element | ShadowRoot): OverlayHost {
  const document = target.ownerDocument;
  const host = document.createElement('div');
  host.setAttribute(HOST_ATTRIBUTE, '');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLES;
  const container = document.createElement('div');
  shadow.append(style, container);
  target.appendChild(host);
  return { host, shadow, container, remove: () => host.remove() };
}
