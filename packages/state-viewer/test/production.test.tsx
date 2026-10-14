// R28: in production builds <StateViewer /> renders nothing. src/index.tsx reads process.env.NODE_ENV when it's
// evaluated, so each test imports a fresh copy under the environment it needs.

import { render } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { REGISTRY_KEY } from '../src/core/registry';
import { flush, resetRegistry } from './xstate/helpers';

const originalNodeEnv = process.env.NODE_ENV;

async function importEntry(nodeEnv: string) {
  process.env.NODE_ENV = nodeEnv;
  vi.resetModules();
  return import('../src/index');
}

beforeEach(() => {
  resetRegistry();
  window.history.replaceState(null, '', '/?debug-state=toggle:on');
});

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  window.history.replaceState(null, '', '/');
});

test('in production, StateViewer renders nothing, loads no fixtures and creates no registry', async () => {
  const { StateViewer } = await importEntry('production');
  const fixtures = vi.fn(() => []);

  const { container } = render(<StateViewer defaultOpen fixtures={fixtures} />);
  await flush();

  expect(container.innerHTML).toBe('');
  expect(document.querySelector('[data-state-viewer-root]')).toBeNull();
  expect(fixtures).not.toHaveBeenCalled();
  expect(REGISTRY_KEY in globalThis).toBe(false);
});

test('outside production, StateViewer mounts the overlay', async () => {
  const { StateViewer } = await importEntry('development');
  const fixtures = vi.fn(() => []);

  render(<StateViewer fixtures={fixtures} />);
  await flush();

  expect(document.querySelector('[data-state-viewer-root]')?.shadowRoot).not.toBeNull();
  expect(fixtures).toHaveBeenCalled();
  expect(REGISTRY_KEY in globalThis).toBe(true);
});
