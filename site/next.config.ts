import { readdir, readFile } from 'node:fs/promises';
import createMDX from '@next/mdx';
import path from 'node:path';
import type { NextConfig } from 'next';
import { MARKERS } from '../scripts/debug-markers.mjs';

const keepOverlayInProduction = {
  condition: { path: /packages\/kotick\/src\// },
  loaders: [path.join(import.meta.dirname, 'kotick-dev-loader.cjs')],
};

const config: NextConfig = {
  transpilePackages: ['kotick'],
  async redirects() {
    return [{ source: '/docs', destination: '/', permanent: false }];
  },
  async rewrites() {
    return [
      { source: '/index.md', destination: '/md' },
      { source: '/docs/:slug([a-z-]+)\\.md', destination: '/docs/:slug/md' },
    ];
  },
  experimental: {
    agentUpgrade: 'security',
  },
  turbopack: {
    rules: {
      '*.ts': keepOverlayInProduction,
      '*.tsx': keepOverlayInProduction,
    },
  },
  compiler: {
    async runAfterProductionCompile({ distDir }) {
      // On Vercel, the client chunks are in static/immutable/ and not in static/chunks/.
      const assets = path.join(distDir, 'static');
      const files = (await readdir(assets, { recursive: true })).filter((file) => file.endsWith('.js'));
      const code = (await Promise.all(files.map((file) => readFile(path.join(assets, file), 'utf8')))).join('\n');
      const missing = Object.entries(MARKERS).flatMap(([marker, part]) => (code.includes(marker) ? [] : [part]));

      if (missing.length > 0) {
        throw new Error(
          `The client chunks do not have these parts of kotick: ${missing.join(', ')}. ` +
            'The demo needs them. Check the *.ts and *.tsx rules in site/next.config.ts.',
        );
      }

      console.log(`✓ The client chunks have all ${Object.keys(MARKERS).length} parts of the kotick debug code`);
    },
  },
};

const withMDX = createMDX({
  options: {
    remarkPlugins: ['remark-gfm', path.join(import.meta.dirname, 'src/mdx/remark-headings.mjs')],
  },
});

export default withMDX(config);
