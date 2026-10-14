import type { NextConfig } from 'next';

// check.mjs builds once with Turbopack and once with webpack, each into its own directory.
const config: NextConfig = { distDir: process.env.NEXT_DIST_DIR ?? '.next' };

export default config;
