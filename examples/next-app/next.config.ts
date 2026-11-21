import type { NextConfig } from 'next';

const config: NextConfig = {
  // The workspace gives shiru as TypeScript source. The npm package is JavaScript and doesn't need this.
  transpilePackages: ['shiru'],
  experimental: {
    agentUpgrade: 'security',
  },
};

export default config;
