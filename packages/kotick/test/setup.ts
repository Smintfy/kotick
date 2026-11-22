import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

// The library has to work with StrictMode's double mount, so every test renders under it.
configure({ reactStrictMode: true });

recordPointerCapture();

function recordPointerCapture(): void {
  if (typeof Element === 'undefined') return;
  const captured = new WeakMap<Element, Set<number>>();

  const idsOf = (element: Element): Set<number> => {
    const ids = captured.get(element) ?? new Set<number>();
    captured.set(element, ids);

    return ids;
  };

  Element.prototype.setPointerCapture = function (this: Element, pointerId: number) {
    idsOf(this).add(pointerId);
  };

  Element.prototype.hasPointerCapture = function (this: Element, pointerId: number) {
    return idsOf(this).has(pointerId);
  };

  Element.prototype.releasePointerCapture = function (this: Element, pointerId: number) {
    idsOf(this).delete(pointerId);
  };
}

beforeEach(() => {
  // Server tests have no page.
  if (typeof window === 'undefined') return;
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  // Vitest globals are off, so Testing Library can't register its own cleanup.
  cleanup();
  writePendingRecordings();
});

/**
 * A pagehide makes the page write its recordings at once.
 * Without it, the page writes them 500 ms after a visit, which can be during the next test.
 */
function writePendingRecordings(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('pagehide'));
}
