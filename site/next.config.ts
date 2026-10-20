import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { NextConfig } from 'next';
import { MARKERS } from '../scripts/debug-markers.mjs';

const keepOverlayInProduction = {
  condition: { path: /packages\/state-viewer\/src\// },
  loaders: [path.join(import.meta.dirname, 'state-viewer-dev-loader.cjs')],
};

const config: NextConfig = {
  transpilePackages: ['state-viewer'],
  turbopack: {
    rules: {
      '*.md': { type: 'text' },
      '*.ts': keepOverlayInProduction,
      '*.tsx': keepOverlayInProduction,
    },
  },
  compiler: {
    async runAfterProductionCompile({ distDir }) {
      const chunks = path.join(distDir, 'static', 'chunks');
      const files = (await readdir(chunks, { recursive: true })).filter((file) => file.endsWith('.js'));
      const code = (await Promise.all(files.map((file) => readFile(path.join(chunks, file), 'utf8')))).join('\n');
      const missing = Object.entries(MARKERS).flatMap(([marker, part]) => (code.includes(marker) ? [] : [part]));
      if (missing.length > 0) {
        throw new Error(
          `The client chunks do not have these parts of state-viewer: ${missing.join(', ')}. ` +
            'The demo needs them. Check the *.ts and *.tsx rules in site/next.config.ts.',
        );
      }
      console.log(`✓ The client chunks have all ${Object.keys(MARKERS).length} parts of the state-viewer debug code`);
    },
  },
};

export default config;
