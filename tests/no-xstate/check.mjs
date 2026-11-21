// The builds of an app that installs kotick without XState.
// tests/bundles/check.mjs installs a copy of this fixture with the tarball of kotick, and runs each build on it.
// The other fixture and every combination of the test matrix install xstate and @xstate/react.
// So only this fixture shows that an app of kotick and kotick/reducer installs, type-checks and builds without them.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { buildNext, buildReactRouter, check, run } from '../bundles/harness.mjs';

/** A build of this fixture. Its name starts with "no-xstate", so `--only no-xstate` selects all of them. */
function build(step, steps) {
  const name = `no-xstate ${step}`;

  return { name, build: (dir) => steps(dir, name) };
}

// The options of tests/bundles/esbuild.mjs, which sets NODE_ENV to production through --minify.
const ESBUILD_OPTIONS = [
  '--bundle',
  '--minify',
  '--splitting',
  '--format=esm',
  '--platform=browser',
  '--jsx=automatic',
];

export const noXstate = {
  dir: import.meta.dirname,
  builds: [
    build('dependencies', (dir) => {
      const args = ['ls', '--depth', 'Infinity', '--parseable', 'xstate', '@xstate/react'];
      console.log(`\n$ pnpm ${args.join(' ')}`);
      const ls = spawnSync('pnpm', args, { cwd: dir, encoding: 'utf8' });

      if (ls.status !== 0 || ls.stdout.trim() !== '') {
        const output = `${ls.stdout}${ls.stderr}`;
        throw new Error(`pnpm ls must find neither package. It exited with ${ls.status} and printed:\n${output}`);
      }
    }),
    // tsc runs before the Next.js builds, because they add the types that they generate to tsconfig.json.
    build('tsc', (dir) => run('pnpm', ['exec', 'tsc', '--noEmit'], dir)),
    build('esbuild', (dir, name) => {
      run('pnpm', ['exec', 'esbuild', 'src/main.tsx', ...ESBUILD_OPTIONS, '--outdir=out/esbuild'], dir);
      check(name, 'client', join(dir, 'out/esbuild'));
    }),
    build('vite', (dir, name) => {
      run('pnpm', ['exec', 'vite', 'build', '--outDir', 'out/vite'], dir);
      check(name, 'client', join(dir, 'out/vite'));
    }),
    build('next (turbopack)', (dir, name) => buildNext(name, dir, 'turbopack')),
    build('next (webpack)', (dir, name) => buildNext(name, dir, 'webpack')),
    build('react-router', (dir, name) => buildReactRouter(name, join(dir, 'react-router'))),
  ],
};
