import type { NextConfig } from 'next';

const config: NextConfig = {
  // The workspace gives konat as TypeScript source. The npm package is JavaScript and doesn't need this.
  transpilePackages: ['konat'],
};

export default config;
