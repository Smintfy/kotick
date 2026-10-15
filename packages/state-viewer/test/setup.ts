import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

// The library has to work with StrictMode's double mount, so every test renders under it.
configure({ reactStrictMode: true });

// Each test starts on a clean page. The overlay keeps its settings in localStorage, recordings go to
// sessionStorage, and deep links come from the URL. Server tests have no page.
beforeEach(() => {
  if (typeof window === 'undefined') return;
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

// Vitest globals are off, so Testing Library can't register its own cleanup.
afterEach(cleanup);
