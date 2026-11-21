import { defineConfig, type UserConfig } from 'tsdown';

// konat/reducer is three files, and no package export names the two inner files.
const INNER = ['./reducer-machine', './reducer-hook'];

const common: UserConfig = {
  platform: 'neutral',
  dts: true,
  exports: {
    devExports: true,
    // The docs site and the tests import konat/figure from the workspace. It is no entry, so no build or publish has it.
    // Each build writes the exports of package.json again, and without this function it removes the figure.
    customExports: (exports, { isPublish }) => {
      const entries = Object.fromEntries(Object.entries(exports).filter(([path]) => !INNER.includes(path)));

      return isPublish ? entries : { ...entries, './figure': './src/figure.tsx' };
    },
  },
  // The entries with 'use client' start with it, and rolldown keeps it at the top of their output files.
  checks: { moduleLevelDirective: false },
};

/**
 * Makes a build import the output file of another build in place of that build's modules.
 * So no code is in two files, and the directive of each file stays at its top.
 */
function otherBuilds(files: Readonly<Record<string, string>>): NonNullable<UserConfig['plugins']> {
  return {
    name: 'other-builds',
    resolveId: (source: string) => (Object.hasOwn(files, source) ? { id: files[source], external: true } : null),
  };
}

// Each entry has its own build, so the entries share no chunk.
// Turbopack keeps a chunk that a 'use client' entry imports, also when only code that production builds remove uses it.
// Two copies of the core are safe, because both entries use the one registry on globalThis.
export default defineConfig([
  { ...common, entry: ['src/index.tsx'] },
  { ...common, entry: ['src/xstate.ts'] },
  // Server code imports a machine file, so the definition module has no directive and no React import.
  // rolldown drops a directive that isn't at the top of an entry file, so the 'use client' hook module is a build too.
  { ...common, entry: { 'reducer-machine': 'src/reducer/machine.ts' } },
  {
    ...common,
    entry: { 'reducer-hook': 'src/reducer/hook.ts' },
    plugins: [otherBuilds({ './machine': './reducer-machine.js' })],
  },
  {
    ...common,
    entry: { reducer: 'src/reducer.ts' },
    // src/reducer/define-fixtures.ts imports the definition module as ./machine.
    plugins: [
      otherBuilds({
        './reducer/machine': './reducer-machine.js',
        './machine': './reducer-machine.js',
        './reducer/hook': './reducer-hook.js',
      }),
    ],
  },
]);
