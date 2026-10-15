// @vitest-environment node
// <StateViewer /> renders on the server like any client component, and does nothing there.
// It renders no markup, loads no fixtures, and creates no registry on the shared globalThis.

import { renderToString } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import { REGISTRY_KEY } from '../../src/core/registry';
import { StateViewer } from '../../src/index';

afterEach(() => {
  vi.restoreAllMocks();
});

test('renders nothing on the server, and loads no fixtures', () => {
  const error = vi.spyOn(console, 'error');
  const fixtures = vi.fn(() => []);

  expect(renderToString(<StateViewer defaultOpen fixtures={fixtures} />)).toBe('');
  expect(fixtures).not.toHaveBeenCalled();
  expect(REGISTRY_KEY in globalThis).toBe(false);
  // No warning about layout effects on the server either.
  expect(error).not.toHaveBeenCalled();
});
