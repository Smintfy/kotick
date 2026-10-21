import { defineConfig, type UserConfig } from 'tsdown';

const common: UserConfig = {
  platform: 'neutral',
  dts: true,
  exports: { devExports: true },
  // Both entries start with 'use client', and rolldown keeps it at the top of their output files.
  checks: { moduleLevelDirective: false },
};

// Each entry has its own build, so the entries share no chunk.
// Turbopack keeps a chunk that a 'use client' entry imports, also when only code that production builds remove uses it.
// Two copies of the core are safe, because both entries use the one registry on globalThis.
export default defineConfig([
  { ...common, entry: ['src/index.tsx'] },
  { ...common, entry: ['src/xstate.ts'] },
]);
