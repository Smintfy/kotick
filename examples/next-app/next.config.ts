import type { NextConfig } from 'next';

const config: NextConfig = {
  // The workspace gives state-viewer as TypeScript source. The npm package is JavaScript and doesn't need this.
  transpilePackages: ['state-viewer'],
};

export default config;
