import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

const PRODUCTION = 'test/production.test.tsx';
const XSTATE_PRODUCTION = 'test/xstate-production.test.tsx';

// Node resolves without the development condition, so this is the entry of XState's production build.
const XSTATE_PRODUCTION_ENTRY = fileURLToPath(import.meta.resolve('xstate'));

// All projects extend this config, so all use jsdom and the setup file.
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    projects: [
      {
        test: {
          name: 'default',
          exclude: [...configDefaults.exclude, PRODUCTION, XSTATE_PRODUCTION],
          typecheck: { enabled: true },
        },
      },
      {
        // React and the package's entries read NODE_ENV when they load.
        // Vite compiles JSX for development when its NODE_ENV is not 'production', and production React has no jsxDEV.
        oxc: { jsx: { development: false } },
        test: { name: 'production', include: [PRODUCTION], env: { NODE_ENV: 'production' } },
      },
      {
        // A bundler without the development condition, such as esbuild, gives an app XState's production build.
        // Vitest adds that condition to every project, so this one imports the production entry by its path.
        // The package's own code still runs as in development.
        // @xstate/react imports XState itself, so it still gets the development build. This project doesn't use it.
        resolve: { alias: [{ find: /^xstate$/, replacement: XSTATE_PRODUCTION_ENTRY }] },
        test: { name: 'xstate-production', include: [XSTATE_PRODUCTION] },
      },
    ],
  },
});
