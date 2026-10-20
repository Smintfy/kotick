# state-viewer

A development overlay that lists every state of every XState machine on the page, and previews any of them in place.
For installation and usage, see the [package README](packages/state-viewer/README.md).

## Repository

| Path | Contents |
|---|---|
| `packages/state-viewer` | The package: the registry and overlay (`state-viewer`) and the XState adapter (`state-viewer/xstate`) |
| `examples/vite-react` | Vite and React Router. One page for each way to read a machine: `useMachine`, `createActorContext`, `useActor`, and `connect()` in the header |
| `examples/hostile-css` | A page with global styles that try to change the overlay |
| `examples/next-app` | The Next.js App Router, with server rendering |
| `tests/bundles` | A fixture app for the production-build check |
| `scripts` | The test matrix, and the strings that only debug code contains, for `pnpm check:bundles` and the site build |
| `specs` | The [MVP spec and roadmap](specs/state-debugger-mvp-spec.md) |

The end-to-end tests are in a separate repository, [state-viewer-e2e](../state-viewer-e2e), and run against the
examples.

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
| `pnpm build` | Builds the package and the examples |
| `pnpm test` | Runs `pnpm lint`, then the unit, adapter and type tests with Vitest |
| `pnpm typecheck` | Checks the types of the package and the examples |
| `pnpm lint` | Runs oxlint over the repository with the rules in `.oxlintrc.json` |
| `pnpm test:matrix` | Runs the tests on React 18 and 19, each with the minimum and the latest XState |
| `pnpm check:bundles` | Builds apps for production with esbuild, Vite, Next.js and React Router, and looks for debug code |
| `pnpm --filter state-viewer styles` | Writes the overlay's CSS from `styles.css` to `src/overlay/styles.generated.ts` |
| `pnpm --filter state-viewer bench` | Measures the cost of the adapter in development, against `@xstate/react` |

The overlay's components use Tailwind v4 utilities. Tailwind is a devDependency: it compiles
`packages/state-viewer/styles.css` into `src/overlay/styles.generated.ts`, and the package ships that CSS as a string.
The style watcher writes the file again when a component or `styles.css` changes. Commit the file with the change.

`test:matrix` and `check:bundles` install packages in temporary directories, so they need network access and take a
few minutes. Both accept `--only <name>` to run part of the work, and `--keep` to keep the temporary directories.

Tests use the package the way an app does, with no mocks. The rules are in
[writing-tests](packages/state-viewer/.claude/skills/writing-tests/SKILL.md), and `pnpm lint` enforces most of them.
