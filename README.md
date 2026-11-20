# konat

A development overlay that lists every state of every state machine on the page, and previews any of them in place. It supports XState v5.
For installation and usage, see the [package README](packages/konat/README.md).

## Repository

| Path | Contents |
|---|---|
| `packages/konat` | The package: the registry and overlay (`konat`) and the XState adapter (`konat/xstate`) |
| `examples/vite-react` | Vite and React Router. One page for each way to read a machine: `useMachine`, `createActorContext`, `useActor`, and `connect()` in the header |
| `examples/hostile-css` | A page with global styles that try to change the overlay |
| `examples/next-app` | The Next.js App Router, with server rendering |
| `site` | The landing page and the docs, in Next.js. The docs pages are MDX files in `site/src/content/docs` |
| `tests/bundles` | A fixture app for the production-build check |
| `tests/no-xstate` | A fixture app with konat and no XState, for the same check |
| `scripts` | The test matrix, and the strings that only debug code contains, for `pnpm check:bundles` and the site build |

## Development

The repository uses pnpm workspaces. The examples use the TypeScript source of the package, so changes show without a
build.

```bash
pnpm install
```

| Script | What it does |
|---|---|
| `pnpm dev` | Starts the vite-react example on port 5173, and the style watcher |
| `pnpm dev:hostile-css` | Starts the hostile-css example on port 5174, and the style watcher |
| `pnpm dev:next` | Starts the Next.js example on port 3100, and the style watcher |
| `pnpm dev:site` | Starts the site on port 3200, and the style watcher |
| `pnpm build` | Builds the package, the examples and the site |
| `pnpm test` | Runs `pnpm lint`, then the unit, adapter and type tests with Vitest, and builds the site |
| `pnpm typecheck` | Checks the types of the package, the examples and the site |
| `pnpm lint` | Runs oxlint over the repository with the rules in `.oxlintrc.json` |
| `pnpm test:matrix` | Runs the tests on React 18 and 19, each with the minimum and the latest XState |
| `pnpm check:bundles` | Builds apps for production with esbuild, Vite, Next.js and React Router, with and without XState, and looks for debug code |
| `pnpm --filter konat styles` | Writes the overlay's CSS from `styles.css` to `src/styles.generated.ts` |
| `pnpm --filter konat bench` | Measures the cost of the adapter in development, against `@xstate/react` |

The overlay's components use Tailwind v4 utilities. Tailwind is a devDependency: it compiles
`packages/konat/styles.css` into `src/styles.generated.ts`, and the package ships that CSS as a string.
The style watcher writes the file again when a component or `styles.css` changes. Commit the file with the change.

`test:matrix` and `check:bundles` install packages in temporary directories, so they need network access and take a
few minutes. Both accept `--only <name>` to run part of the work, and `--keep` to keep the temporary directories.

Tests use the package the way an app does, with no mocks. The rules are in
[writing-tests](packages/konat/.claude/skills/writing-tests/SKILL.md), and `pnpm lint` enforces most of them.

The docs pages of the site are MDX files in `site/src/content/docs`, and `site/src/site.tsx` lists them in the
sequence of the nav. The site build fails when a docs link goes to a page or a heading that does not exist, when a code
block has a language that Highlights does not support, or when the build loses the overlay that the demo on the landing
page shows.
