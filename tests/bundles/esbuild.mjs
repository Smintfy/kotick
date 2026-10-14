// Builds an entry as an app's own esbuild script does: bundled, minified, split into chunks.
// esbuild sets process.env.NODE_ENV to "production" when it minifies for the browser.
// Usage: node esbuild.mjs <entry> <outdir>

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as esbuild from 'esbuild';

const [entry, outdir] = process.argv.slice(2);
const result = await esbuild.build({
  entryPoints: { main: entry },
  outdir,
  bundle: true,
  minify: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  metafile: true,
  logLevel: 'warning',
});
writeFileSync(join(outdir, 'meta.json'), JSON.stringify(result.metafile));
