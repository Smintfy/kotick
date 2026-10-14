import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // Runs *.test-d.ts files through tsc, for expectTypeOf checks on the public API.
    typecheck: { enabled: true },
  },
});
