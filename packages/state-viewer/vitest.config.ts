import { configDefaults, defineConfig } from 'vitest/config';

const PRODUCTION = 'test/production.test.tsx';

// Both projects extend this config, so both use jsdom and the setup file.
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    projects: [
      {
        test: {
          name: 'default',
          exclude: [...configDefaults.exclude, PRODUCTION],
          // Runs *.test-d.ts files through tsc, for expectTypeOf checks on the public API.
          typecheck: { enabled: true },
        },
      },
      {
        // React and the package's entries read NODE_ENV when they load.
        // Vite compiles JSX for development when its NODE_ENV is not 'production', and production React has no jsxDEV.
        oxc: { jsx: { development: false } },
        test: { name: 'production', include: [PRODUCTION], env: { NODE_ENV: 'production' } },
      },
    ],
  },
});
