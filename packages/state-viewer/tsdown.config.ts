import { defineConfig, type UserConfig } from 'tsdown';

const common: UserConfig = {
  platform: 'neutral',
  dts: true,
  exports: { devExports: true },
  // Both entries start with 'use client', and rolldown keeps it at the top of their output files.
  checks: { moduleLevelDirective: false },
};

// Each entry is built on its own, so the core modules are in both files and no chunk is shared (spec §10.7).
// Turbopack keeps a shared chunk when a module imports it, also when only code that production builds remove uses it.
// Two copies of the core are safe: the registry is on globalThis, so both entries use the same one (§10.1).
export default defineConfig([
  { ...common, entry: ['src/index.tsx'] },
  { ...common, entry: ['src/xstate.ts'] },
]);
