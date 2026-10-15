import * as React from 'react';
import { configDefaults, defineConfig } from 'vitest/config';

// These files are built on <Activity> or use(), which React 18 doesn't have. The test matrix (scripts/test-matrix.mjs)
// runs the suite on React 18 without them. Files that only partly need <Activity> skip those parts themselves.
const REACT_19_ONLY = [
  'test/regressions/debug-disabled-while-hidden.test.tsx',
  'test/regressions/held-ending-across-actor-replacement.test.tsx',
  'test/regressions/owed-ending-timing.test.tsx',
  'test/regressions/stable-observer-actor-replacement.test.tsx',
  'test/regressions/stable-observer-left-on-preview.test.tsx',
  'test/regressions/stable-observer-replaced-while-disabled.test.tsx',
  'test/regressions/uncommitted-render-observers.test.tsx',
];

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
          exclude: [...configDefaults.exclude, ...('Activity' in React ? [] : REACT_19_ONLY), PRODUCTION],
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
