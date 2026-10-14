import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// The library has to work with StrictMode's double mount, so every test renders under it.
configure({ reactStrictMode: true });

// Vitest globals are off, so Testing Library can't register its own cleanup.
afterEach(cleanup);
