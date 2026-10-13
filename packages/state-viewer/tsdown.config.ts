import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.tsx', 'src/xstate.ts'],
  platform: 'neutral',
  dts: true,
  exports: { devExports: true },
  banner: { js: "'use client';" },
});
