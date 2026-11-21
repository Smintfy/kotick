import type { NextConfig } from 'next';

const config: NextConfig = {
  // The workspace gives kotick as TypeScript source. The npm package is JavaScript and doesn't need this.
  transpilePackages: ['kotick'],
  experimental: {
    agentUpgrade: 'security',
  },
};

export default config;
