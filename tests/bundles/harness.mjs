// The code that the builds of tests/bundles and tests/no-xstate share: the commands, the marker scan and the results.
// check.mjs in this directory runs the builds of both fixtures and prints the results.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MARKERS } from '../../scripts/debug-markers.mjs';

export const root = join(import.meta.dirname, '../..');

// The builds set NODE_ENV themselves, as they do in an app's CI.
export const env = { ...process.env, CI: 'true', NEXT_TELEMETRY_DISABLED: '1' };

delete env.NODE_ENV;

export function run(command, args, cwd, extraEnv = {}) {
  console.log(`\n$ ${command} ${args.join(' ')}   (in ${relative(root, cwd) || '.'})`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...env, ...extraEnv } });

  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
}

function jsFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];

  for (const entry of readdirSync(dir, { recursive: true })) {
    const path = join(dir, entry);

    if (/\.(c|m)?js$/.test(entry) && statSync(path).isFile()) files.push(path);
  }

  return files;
}

/** The markers each file of `dir` contains, as `{ file, marker }` pairs. */
function scan(dir) {
  const hits = [];

  for (const file of jsFiles(dir)) {
    const code = readFileSync(file, 'utf8');

    for (const marker of Object.keys(MARKERS)) {
      if (code.includes(marker)) hits.push({ file: relative(dir, file), marker });
    }
  }

  return hits;
}

// Every export of konat that holds code. A server bundle that leaves konat/figure to Node loads konat at runtime too.
const konatSpecifiers = Object.keys(JSON.parse(readFileSync(join(root, 'packages/konat/package.json'), 'utf8')).exports)
  .filter((path) => path !== './package.json')
  .map((path) => path.replace(/^\./, 'konat'));

const konatLoad = new RegExp(`(?:\\bfrom|\\bimport|\\brequire\\()\\s*\\(?\\s*["'](?:${konatSpecifiers.join('|')})["']`);

/** True when a server bundle leaves konat to Node, which reads NODE_ENV when the server starts. */
function importsAtRuntime(dir) {
  return jsFiles(dir).some((file) => konatLoad.test(readFileSync(file, 'utf8')));
}

/** One row per scanned output. */
export const rows = [];
export const failures = [];

export function check(name, output, dir, extra = '') {
  if (!existsSync(dir)) throw new Error(`${name}: no ${output} output in ${dir}.`);
  const hits = scan(dir);
  const runtime = output === 'server' && hits.length === 0 && importsAtRuntime(dir);
  rows.push({ name, output, hits, note: runtime ? 'imports konat at runtime' : extra });
}

/**
 * Builds the Next.js app in `dir` with Turbopack or webpack, and scans both outputs.
 * Each bundler builds into its own directory, which the next.config.ts of the fixture reads from NEXT_DIST_DIR.
 * Returns that directory.
 */
export function buildNext(name, dir, bundler) {
  const distDir = `.next-${bundler}`;
  run('pnpm', ['exec', 'next', 'build', `--${bundler}`], dir, { NEXT_DIST_DIR: distDir });
  check(name, 'client', join(dir, distDir, 'static'));
  check(name, 'server', join(dir, distDir, 'server'));

  return distDir;
}

/** Builds the React Router app in `appDir`, and scans both outputs. */
export function buildReactRouter(name, appDir) {
  run('pnpm', ['exec', 'react-router', 'build'], appDir);
  check(name, 'client', join(appDir, 'build/client'));
  check(name, 'server', join(appDir, 'build/server'));
}
