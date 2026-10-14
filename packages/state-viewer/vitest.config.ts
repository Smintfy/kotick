import * as React from 'react';
import { configDefaults, defineConfig } from 'vitest/config';

// These files are built on <Activity> or use(), which React 18 doesn't have. The test matrix (scripts/test-matrix.mjs)
// runs the suite on React 18 without them. Files that only partly need <Activity> skip those parts themselves.
const REACT_19_ONLY = [
  'test/regressions/app-stop-held-across-activity.test.tsx',
  'test/regressions/debug-disabled-while-hidden.test.tsx',
  'test/regressions/held-ending-across-actor-replacement.test.tsx',
  'test/regressions/held-ending-dropped-after-told.test.tsx',
  'test/regressions/owed-ending-timing.test.tsx',
  'test/regressions/stable-observer-actor-replacement.test.tsx',
  'test/regressions/stable-observer-left-on-preview.test.tsx',
  'test/regressions/stable-observer-replaced-while-disabled.test.tsx',
  'test/regressions/uncommitted-render-observers.test.tsx',
];

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    exclude: 'Activity' in React ? configDefaults.exclude : [...configDefaults.exclude, ...REACT_19_ONLY],
    // Runs *.test-d.ts files through tsc, for expectTypeOf checks on the public API.
    typecheck: { enabled: true },
  },
});
