import { overlayStyles } from '../styles.generated';

const HOST_ATTRIBUTE = 'data-konat-root';

export interface OverlayHost {
  host: HTMLElement;
  shadow: ShadowRoot;
  style: HTMLStyleElement;
  container: HTMLElement;
  remove(): void;
}

export function createHost(target: Element | ShadowRoot): OverlayHost {
  const document = target.ownerDocument;
  const host = document.createElement('div');
  host.setAttribute(HOST_ATTRIBUTE, '');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = overlayStyles();
  const container = document.createElement('div');
  shadow.append(style, container);
  target.appendChild(host);

  return { host, shadow, style, container, remove: () => host.remove() };
}
