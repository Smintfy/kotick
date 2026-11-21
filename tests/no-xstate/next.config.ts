import type { NextConfig } from 'next';

const config: NextConfig = {
  // The check builds once with Turbopack and once with webpack, each into its own directory.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // tsconfig.json has skipLibCheck: false, and the declaration files of Next.js fail with it.
  // The check runs tsc on src itself.
  typescript: { ignoreBuildErrors: true },
};

export default config;
