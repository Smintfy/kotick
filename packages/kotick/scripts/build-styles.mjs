// Compiles styles.css with Tailwind and writes the minified CSS to src/styles.generated.ts.
// The CSS goes into a TypeScript module, so every bundler gets it as a string, with no CSS pipeline.
//
// Usage:
//   node scripts/build-styles.mjs            write the file
//   node scripts/build-styles.mjs --check    exit 1 when the file is stale
//   node scripts/build-styles.mjs --watch    write the file again on each change to styles.css or a component

import { compile, optimize, Polyfills } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { existsSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';

const root = join(import.meta.dirname, '..');
const input = join(root, 'styles.css');
const output = join(root, 'src/styles.generated.ts');
const components = join(root, 'src/components');

// The root dev scripts give their arguments, such as Vite's --port, to each dev script, so unknown options are ignored.
const { values } = parseArgs({
  options: { check: { type: 'boolean', default: false }, watch: { type: 'boolean', default: false } },
  strict: false,
});

async function generate() {
  // withPropertyFallbacks() replaces Tailwind's own @property fallback, which only browsers without @property get.
  const compiler = await compile(readFileSync(input, 'utf8'), {
    base: root,
    from: input,
    polyfills: Polyfills.None,
    onDependency() {},
  });

  const candidates = new Scanner({ sources: compiler.sources }).scan();
  const { code } = optimize(withPropertyFallbacks(compiler.build(candidates)), { minify: true });
  const rem = code.match(/[\d.]+rem\b/);

  if (rem) throw new Error(`The CSS contains ${rem[0]}. Use px, because the page sets the root font size.`);

  return `// Generated from styles.css by scripts/build-styles.mjs. Do not edit it.
// Run \`pnpm --filter kotick styles\` to write it again.

/** It is a function, so production builds can remove it. */
export function overlayStyles(): string {
  return ${JSON.stringify(code.trim())};
}
`;
}

/**
 * Shadow roots ignore @property, so the --tw-* properties that Tailwind registers have no initial values there.
 * A utility that reads one, such as a border width or a pseudo-element's content, then gets an invalid value.
 * The properties layer comes first, so the utilities that set a property win.
 */
function withPropertyFallbacks(css) {
  const declarations = [...css.matchAll(/@property\s+(--tw-[\w-]+)\s*\{([^}]*)\}/g)].map(([, name, body]) => {
    const initial = body.match(/initial-value:\s*([^;]*?)\s*(;|$)/);

    return `${name}: ${initial ? initial[1] : 'initial'};`;
  });

  if (declarations.length === 0) return css;
  const rule = `:host, *, ::before, ::after, ::backdrop { ${declarations.join(' ')} }`;

  return `${css}\n@layer properties { ${rule} }\n`;
}

function current() {
  return existsSync(output) ? readFileSync(output, 'utf8') : '';
}

async function write() {
  const next = await generate();

  if (next === current()) return false;
  writeFileSync(output, next);

  return true;
}

const name = relative(root, output);

if (values.check) {
  if ((await generate()) !== current()) {
    console.error(`${name} is stale. Run pnpm --filter kotick styles.`);
    process.exit(1);
  }
} else if (values.watch) {
  let queued = Promise.resolve();

  const rebuild = () => {
    queued = queued.then(async () => {
      try {
        if (await write()) console.log(`[styles] wrote ${name}`);
      } catch (error) {
        console.error(`[styles] ${error instanceof Error ? error.message : error}`);
      }
    });
  };

  rebuild();
  // Editors often save with a rename, so the watcher follows the directory, not the file.
  watch(root, (_event, file) => file === 'styles.css' && rebuild());
  watch(components, { recursive: true }, rebuild);
  console.log(`[styles] watching styles.css and ${relative(root, components)}`);
} else {
  console.log((await write()) ? `Wrote ${name}.` : `${name} is up to date.`);
}
