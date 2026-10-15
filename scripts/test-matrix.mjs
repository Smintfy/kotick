// Runs the state-viewer test suite against other versions of React, XState and @xstate/react.
// The workspace installs one version of each, so every combination gets a copy of the package in a temporary
// directory with its own install.
//
// Usage:
//   node scripts/test-matrix.mjs                     every combination in COMBOS
//   node scripts/test-matrix.mjs --only react-18     the combinations whose name contains "react-18"
//   node scripts/test-matrix.mjs --react 18.3.1 --xstate 5.19.0 --xstate-react 5.0.0
//                                                    one custom combination
//   --keep                                           keep the temporary directories for inspection

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const root = join(import.meta.dirname, '..');
const packageDir = join(root, 'packages/state-viewer');

// The minimum versions are the lowest that the peer ranges in packages/state-viewer/package.json allow.
// Keep the two in sync.
const MIN = { xstate: '5.28.0', xstateReact: '6.1.0' };
const REACT_18 = { react: '18.3.1', types: '18.3.31', domTypes: '18.3.7' };

const COMBOS = [
  { name: 'react-18 xstate-min', ...REACT_18, ...MIN },
  { name: 'react-18 xstate-latest', ...REACT_18 },
  { name: 'react-19 xstate-min', ...MIN },
  { name: 'react-19 xstate-latest' },
];

const { values } = parseArgs({
  options: {
    only: { type: 'string' },
    react: { type: 'string' },
    xstate: { type: 'string' },
    'xstate-react': { type: 'string' },
    keep: { type: 'boolean', default: false },
  },
});

/** Versions from the `catalog:` section of pnpm-workspace.yaml. The temporary copy is outside the workspace. */
function readCatalog() {
  const yaml = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
  const section = yaml.split(/^catalog:\s*$/m)[1] ?? '';
  const catalog = {};
  for (const line of section.split('\n')) {
    const match = /^\s+'?([^':\s]+)'?:\s*(\S+)\s*$/.exec(line);
    if (match) catalog[match[1]] = match[2];
    else if (/^\S/.test(line)) break;
  }
  return catalog;
}

function combosToRun() {
  if (values.react || values.xstate || values['xstate-react']) {
    const major = values.react?.split('.')[0];
    const custom = { name: 'custom', react: values.react, xstate: values.xstate, xstateReact: values['xstate-react'] };
    if (major === '18') Object.assign(custom, { types: REACT_18.types, domTypes: REACT_18.domTypes });
    return [custom];
  }
  return values.only ? COMBOS.filter((combo) => combo.name.includes(values.only)) : COMBOS;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, CI: 'true' } });
  return result.status === 0;
}

function prepare(combo, catalog) {
  const dir = mkdtempSync(join(tmpdir(), 'state-viewer-matrix-'));
  for (const entry of ['src', 'test', 'tsconfig.json', 'vitest.config.ts']) {
    cpSync(join(packageDir, entry), join(dir, entry), { recursive: true });
  }

  const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const devDependencies = {};
  for (const [name, range] of Object.entries(pkg.devDependencies)) {
    devDependencies[name] = range === 'catalog:' ? catalog[name] : range;
  }
  const pins = {
    react: combo.react,
    'react-dom': combo.react,
    '@types/react': combo.types,
    '@types/react-dom': combo.domTypes,
    xstate: combo.xstate,
    '@xstate/react': combo.xstateReact,
  };
  for (const [name, version] of Object.entries(pins)) {
    if (version) devDependencies[name] = version;
  }

  const copy = {
    // Tests import the package by its name, which resolves through exports.
    name: pkg.name,
    // src/core/version.ts reads it.
    version: pkg.version,
    private: true,
    type: 'module',
    exports: pkg.exports,
    devDependencies,
    // Keeps @xstate/react's nested copy of use-sync-external-store and others on the pinned React.
    pnpm: { overrides: { react: devDependencies.react, 'react-dom': devDependencies['react-dom'] } },
  };
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(copy, null, 2)}\n`);

  // Typechecks the library and the type tests only.
  // Other test files call APIs of the latest XState, such as Actor.select (5.29), in their @xstate/react controls.
  const tsconfig = { extends: './tsconfig.json', include: ['src', 'test/**/*.test-d.ts'] };
  writeFileSync(join(dir, 'tsconfig.matrix.json'), `${JSON.stringify(tsconfig, null, 2)}\n`);
  return { dir, devDependencies };
}

const catalog = readCatalog();
const results = [];

for (const combo of combosToRun()) {
  const { dir, devDependencies } = prepare(combo, catalog);
  const versions = [
    `react ${devDependencies.react}`,
    `xstate ${devDependencies.xstate}`,
    `@xstate/react ${devDependencies['@xstate/react']}`,
  ];
  const label = `${combo.name}: ${versions.join(', ')}`;
  console.log(`\n=== ${label}\n    ${dir}\n`);

  const ok =
    run('pnpm', ['install', '--ignore-workspace', '--no-frozen-lockfile', '--reporter=silent'], dir) &&
    run('pnpm', ['exec', 'vitest', 'run', '--typecheck.tsconfig=tsconfig.matrix.json'], dir);
  results.push({ label, ok });

  if (!values.keep) rmSync(dir, { recursive: true, force: true });
}

console.log('\n=== Results');
for (const { label, ok } of results) console.log(`${ok ? 'pass' : 'FAIL'}  ${label}`);
process.exitCode = results.every((result) => result.ok) ? 0 : 1;
