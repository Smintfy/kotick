import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { NextConfig } from 'next';
import { MARKERS } from '../scripts/debug-markers.mjs';

// In a production build, state-viewer removes its overlay, and <StateViewer /> renders nothing.
// The demo on the landing page must show the overlay, also in the production build.
// Thus, this loader gives "development" as process.env.NODE_ENV to the source of the package.
const devStateViewer = {
  condition: { path: /packages\/state-viewer\/src\// },
  loaders: [path.join(import.meta.dirname, 'state-viewer-dev-loader.cjs')],
};

const config: NextConfig = {
  // The workspace gives state-viewer as TypeScript source.
  transpilePackages: ['state-viewer'],
  turbopack: {
    rules: {
      // The docs pages import the package README as a string.
      '*.md': { type: 'text' },
      '*.ts': devStateViewer,
      '*.tsx': devStateViewer,
    },
  },
  compiler: {
    // Without the loader, the build removes the overlay, and the demo shows only the checkout.
    // This check fails the build when a string that only the debug code contains is in no client chunk.
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
