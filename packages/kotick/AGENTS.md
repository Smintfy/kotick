# kotick

A development overlay for React apps that keep their state in XState v5 machines or in reducer machines.
Each kind of machine has its own adapter, `kotick/xstate` and `kotick/reducer`, and neither is the default.
The README says what the overlay does for a developer.

## Layout

| Path | Contents |
|---|---|
| `src/index.tsx` | The `kotick` entry: `<Kotick />` and its types |
| `src/xstate.ts` | The `kotick/xstate` entry: the hooks, `connect()`, `defineFixtures()` and their types |
| `src/reducer.ts` | The `kotick/reducer` entry: `defineReducerMachine()`, `useMachineReducer()`, `defineFixtures()` and their types. It has no directive, so server code can import a machine file |
| `src/figure.tsx` | The `kotick/figure` entry of the workspace: `<KotickFigure />`, the real panel open on one page, for the docs site. It is no build entry, so no package has it |
| `src/types.ts` | The types that the core, the overlay and the adapters share, and the props of `<Kotick />` |
| `src/core/` | The registry, one per page, and the stores it composes |
| `src/components/` | The overlay: the React components in the shadow root. `kotick.tsx` mounts it. They use Tailwind utilities. `classes.ts` holds the class lists that more than one component uses |
| `src/hooks/` | The overlay's React hooks, one hook per file |
| `src/shared-hooks/` | The React hooks that the overlay and the adapters share, one hook per file. They import only React and the core |
| `src/utils/` | The overlay's modules that are not React: settings, shortcuts, formatting, the shadow host |
| `src/styles.generated.ts` | Generated from `styles.css`. Do not edit it |
| `styles.css` | The overlay's CSS: the Tailwind theme with only our tokens, in px, and the rules that utilities can't express |
| `scripts/build-styles.mjs` | Compiles `styles.css` with Tailwind into `src/styles.generated.ts` |
| `src/xstate/` | The XState adapter. The hooks and `connect()` give the app a proxy of each actor, and give the registry a handle |
| `src/reducer/` | The reducer adapter. Its runtime is production code: `machine.ts` holds the types, `defineReducerMachine()` and the compiled reducer, and imports nothing. `runtime.ts` holds the production hook. `hook.ts` is the only `'use client'` module, and the build packs each of the two as its own file |
| `test/<feature>.test.tsx` | Black-box tests, one feature per file |
| `test/<feature>/` | A feature whose conditions outgrow one file, one file per condition, such as `test/observers/` |
| `test/support/` | Helpers for those tests |

File names are kebab-case, also for components.
The overlay (`components/`, `hooks/` and `utils/`) and the adapters (`xstate/` and `reducer/`) never import each other, and an adapter never imports the other adapter.
`pnpm lint` enforces the layers and what each entry exports. Its message says where an import belongs.

## Tests

Read the writing-tests skill in `.claude/skills/` before you write, change or review a test.

## Checks

The repository has no CI. Before a commit, run `pnpm typecheck` and `pnpm test` from its root.
`pnpm test` runs `pnpm lint` first.
It also fails when `src/styles.generated.ts` is stale.
After a change to `styles.css` or to a class in a component, run `pnpm --filter kotick styles`.
`pnpm dev` does this on each change. Commit the generated file with the change.
After a change to `src/`, also run `pnpm test:matrix` and `pnpm check:bundles`.
They need network access and take a few minutes.
