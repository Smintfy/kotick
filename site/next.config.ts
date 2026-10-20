import type { NextConfig } from 'next';

const config: NextConfig = {
  // The workspace gives state-viewer as TypeScript source.
  transpilePackages: ['state-viewer'],
  turbopack: {
    // The docs pages import the package README as a string.
    rules: { '*.md': { type: 'text' } },
  },
};

export default config;
