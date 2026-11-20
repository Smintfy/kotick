// Confirms that production builds keep none of the debugger.
//
// The fixture app in this directory uses every public export. The script packs konat as npm publishes it,
// installs the tarball into a copy of the fixture in a temporary directory, and builds the copy for production with
// esbuild, Vite, Next.js (Turbopack and webpack) and React Router. Then it builds the examples, which use the
// workspace source. In each output, it looks for strings that only the registry, the overlay and the adapters contain.
// For esbuild and Vite it also compares the JavaScript loaded at startup of each app in PAIRS with the same app written
// without konat, and fails when the difference is over the budget of that pair.
//
// Usage:
//   node tests/bundles/check.mjs                    every bundler, then the examples
//   node tests/bundles/check.mjs --only next        the builds whose name contains "next"
//   node tests/bundles/check.mjs --skip-examples    the fixture only
//   --keep                                          keep the temporary directory for inspection

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { MARKERS } from '../../scripts/debug-markers.mjs';

const root = join(import.meta.dirname, '../..');
const fixtureDir = import.meta.dirname;

/**
 * Each pair is an app that uses one adapter and the same app without konat, as an esbuild entry and a Vite page.
 * Each pair has its own budget, so one adapter can't use the headroom of the other.
 * The output then names the adapter that grew.
 */
const PAIRS = [
  {
    name: 'xstate',
    without: '@xstate/react',
    budget: 512,
    app: { entry: 'src/main.tsx', page: 'index.html' },
    baseline: { entry: 'src/main-baseline.tsx', page: 'baseline.html' },
  },
  {
    name: 'reducer',
    without: 'useReducer',
    budget: 640,
    app: { entry: 'src/main-reducer.tsx', page: 'reducer.html' },
    baseline: { entry: 'src/main-reducer-baseline.tsx', page: 'reducer-baseline.html' },
  },
];

const { values } = parseArgs({
  options: {
    only: { type: 'string' },
    'skip-examples': { type: 'boolean', default: false },
    keep: { type: 'boolean', default: false },
  },
});

// The builds set NODE_ENV themselves, as they do in an app's CI.
const env = { ...process.env, CI: 'true', NEXT_TELEMETRY_DISABLED: '1' };

delete env.NODE_ENV;

function run(command, args, cwd, extraEnv = {}) {
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

function sizeOf(files) {
  let raw = 0;
  let gzip = 0;

  for (const file of files) {
    const code = readFileSync(file);
    raw += code.length;
    gzip += gzipSync(code, { level: 9 }).length;
  }

  return { raw, gzip };
}

/** The JavaScript an esbuild entry loads at startup: the entry and its static imports, not import() chunks. */
function esbuildStartup(dir, outdir) {
  const meta = JSON.parse(readFileSync(join(outdir, 'meta.json'), 'utf8'));
  const outputs = meta.outputs;
  const entry = Object.keys(outputs).find((path) => outputs[path].entryPoint);
  const seen = new Set();

  const visit = (path) => {
    if (seen.has(path)) return;
    seen.add(path);

    for (const imported of outputs[path].imports) {
      if (imported.kind === 'import-statement' && outputs[imported.path]) visit(imported.path);
    }
  };

  visit(entry);

  // Metafile paths are relative to the directory esbuild ran in.
  return [...seen].map((path) => join(dir, path));
}

/** The JavaScript a Vite entry loads at startup, from the build manifest. */
function viteStartup(outdir) {
  const manifest = JSON.parse(readFileSync(join(outdir, '.vite/manifest.json'), 'utf8'));
  const seen = new Set();

  const visit = (key) => {
    if (seen.has(key)) return;
    seen.add(key);

    for (const imported of manifest[key].imports ?? []) visit(imported);
  };

  visit(Object.keys(manifest).find((key) => manifest[key].isEntry));

  return [...seen].map((key) => join(outdir, manifest[key].file));
}

const formatBytes = (bytes) => (Math.abs(bytes) < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(2)} kB`);
const signed = (bytes) => `${bytes >= 0 ? '+' : '-'}${formatBytes(Math.abs(bytes))}`;

/** One row per scanned output. */
const rows = [];
const failures = [];

function check(name, output, dir, extra = '') {
  if (!existsSync(dir)) throw new Error(`${name}: no ${output} output in ${dir}.`);
  const hits = scan(dir);
  const runtime = output === 'server' && hits.length === 0 && importsAtRuntime(dir);
  rows.push({ name, output, hits, note: runtime ? 'imports konat at runtime' : extra });
}

function compare(name, pair, app, baseline) {
  const a = sizeOf(app);
  const b = sizeOf(baseline);
  const growth = a.gzip - b.gzip;

  if (growth > pair.budget) {
    const over = `over the budget of ${formatBytes(pair.budget)}`;
    failures.push(`${name}: startup JS is ${formatBytes(growth)} gzip larger than with ${pair.without}, ${over}.`);
  }

  return `startup JS ${formatBytes(a.gzip)} gzip, ${signed(growth)} vs ${pair.without} (${signed(a.raw - b.raw)} raw)`;
}

/**
 * Builds both apps of each pair with `buildApp(side, outdir)`, and compares the files that `startup(outdir)` lists.
 * Only the app of a pair has konat, so only its output gets a row.
 */
function measurePairs(bundler, dir, buildApp, startup) {
  for (const pair of PAIRS) {
    const name = `${bundler} ${pair.name}`;
    const app = join(dir, 'out', bundler, pair.name, 'app');
    const baseline = join(dir, 'out', bundler, pair.name, 'baseline');
    buildApp(pair.app, app);
    buildApp(pair.baseline, baseline);
    check(name, 'client', app, compare(name, pair, startup(app), startup(baseline)));
  }
}

const builds = [
  {
    name: 'esbuild',
    build(dir) {
      measurePairs(
        'esbuild',
        dir,
        (side, outdir) => run('node', ['esbuild.mjs', side.entry, outdir], dir),
        (outdir) => esbuildStartup(dir, outdir),
      );
    },
  },
  {
    name: 'vite',
    build(dir) {
      measurePairs(
        'vite',
        dir,
        (side, outdir) =>
          run('pnpm', ['exec', 'vite', 'build', '--outDir', outdir, '--emptyOutDir'], join(dir, 'vite'), {
            ENTRY: side.page,
          }),
        viteStartup,
      );
    },
  },
  {
    name: 'next (turbopack)',
    build(dir) {
      run('pnpm', ['exec', 'next', 'build', '--turbopack'], dir, { NEXT_DIST_DIR: '.next-turbopack' });
      check('next (turbopack)', 'client', join(dir, '.next-turbopack/static'));
      check('next (turbopack)', 'server', join(dir, '.next-turbopack/server'));
    },
  },
  {
    name: 'next (webpack)',
    build(dir) {
      run('pnpm', ['exec', 'next', 'build', '--webpack'], dir, { NEXT_DIST_DIR: '.next-webpack' });
      check('next (webpack)', 'client', join(dir, '.next-webpack/static'));
      check('next (webpack)', 'server', join(dir, '.next-webpack/server'));
    },
  },
  {
    name: 'react-router',
    build(dir) {
      const appDir = join(dir, 'react-router');
      run('pnpm', ['exec', 'react-router', 'build'], appDir);
      check('react-router', 'client', join(appDir, 'build/client'));
      check('react-router', 'server', join(appDir, 'build/server'));
    },
  },
];

/** The examples build from the workspace source rather than the tarball. */
const examples = [
  { name: 'examples/vite-react', filter: 'vite-react', outputs: [['client', 'examples/vite-react/dist']] },
  { name: 'examples/hostile-css', filter: 'hostile-css', outputs: [['client', 'examples/hostile-css/dist']] },
  {
    name: 'examples/next-app',
    filter: 'next-app',
    outputs: [
      ['client', 'examples/next-app/.next/static'],
      ['server', 'examples/next-app/.next/server'],
    ],
  },
];

function prepareFixture() {
  run('pnpm', ['--filter', 'konat', 'build'], root);
  const dir = mkdtempSync(join(tmpdir(), 'konat-bundles-'));
  cpSync(fixtureDir, dir, {
    recursive: true,
    filter: (source) => !/(node_modules|\.next[^/]*|\/out|\/build|check\.mjs)$/.test(source),
  });
  run('pnpm', ['pack', '--pack-destination', dir], join(root, 'packages/konat'));
  const tarball = readdirSync(dir).find((file) => /^konat-.*\.tgz$/.test(file));
  renameSync(join(dir, tarball), join(dir, 'konat.tgz'));
  // pnpm runs no install scripts it wasn't allowed to. esbuild's script puts its binary in place.
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'allowBuilds:\n  esbuild: true\n');
  run('pnpm', ['install', '--no-frozen-lockfile', '--reporter=silent'], dir);

  return dir;
}

const selected = builds.filter((build) => !values.only || build.name.includes(values.only));
let dir;

try {
  if (selected.length > 0) {
    dir = prepareFixture();
    console.log(`\nFixture: ${dir}`);

    for (const build of selected) {
      try {
        build.build(dir);
      } catch (error) {
        failures.push(`${build.name}: ${error.message}`);
      }
    }
  }

  if (!values['skip-examples']) {
    for (const example of examples.filter((item) => !values.only || item.name.includes(values.only))) {
      if (!existsSync(join(root, example.name))) continue;

      try {
        run('pnpm', ['--filter', example.filter, 'build'], root);

        for (const [output, path] of example.outputs) check(example.name, output, join(root, path));
      } catch (error) {
        failures.push(`${example.name}: ${error.message}`);
      }
    }
  }
} finally {
  if (dir && !values.keep) rmSync(dir, { recursive: true, force: true });
}

console.log('\n=== Debug code in production builds\n');

for (const { name, output, hits, note } of rows) {
  const parts = [...new Set(hits.map((hit) => MARKERS[hit.marker]))];
  const result = hits.length === 0 ? 'none' : `FOUND ${parts.join(', ')}`;
  console.log(`${name.padEnd(22)} ${output.padEnd(7)} ${result.padEnd(6)} ${note}`);

  for (const hit of hits) console.log(`${''.padEnd(31)}${hit.marker} in ${hit.file}`);
}

for (const failure of failures) console.log(`\nFAILED ${failure}`);

process.exitCode = failures.length === 0 && rows.every((row) => row.hits.length === 0) ? 0 : 1;
