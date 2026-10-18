# state-viewer

A development overlay for React apps that use XState v5. The README says what it does for a developer.

## Layout

| Path | Contents |
|---|---|
| `src/index.tsx` | The `state-viewer` entry: `<StateViewer />` and its types |
| `src/xstate.ts` | The `state-viewer/xstate` entry: the hooks, `connect()`, `defineFixtures()` and their types |
| `src/core/` | The registry, one per page, and the stores it composes. `types.ts` is what the other two layers share |
| `src/overlay/` | The overlay. `StateViewer.tsx` mounts it in a shadow root. The other root modules hold what the components use |
| `src/overlay/components/` | The React components in the shadow root. They use Tailwind utilities. `classes.ts` holds the class lists that more than one component uses |
| `src/overlay/styles.generated.ts` | Generated from `styles.css`. Do not edit it |
| `styles.css` | The overlay's CSS: the Tailwind theme with only our tokens, in px, and the rules that utilities can't express |
| `scripts/build-styles.mjs` | Compiles `styles.css` with Tailwind into `src/overlay/styles.generated.ts` |
| `src/xstate/` | The adapter. The hooks and `connect()` give the app a proxy of each actor, and give the registry a handle |
| `test/<feature>.test.tsx` | Black-box tests, one feature per file |
| `test/<feature>/` | A feature whose conditions outgrow one file, one file per condition, such as `test/observers/` |
| `test/support/` | Helpers for those tests |

The overlay and the adapter never import each other.
`pnpm lint` enforces the layers and what each entry exports. Its message says where an import belongs.

## Tests

Read the writing-tests skill in `.claude/skills/` before you write, change or review a test.

## Checks

The repository has no CI. Before a commit, run `pnpm typecheck` and `pnpm test` from its root.
`pnpm test` runs `pnpm lint` first.
It also fails when `src/overlay/styles.generated.ts` is stale.
After a change to `styles.css` or to a class in a component, run `pnpm --filter state-viewer styles`.
`pnpm dev` does this on each change. Commit the generated file with the change.
After a change to `src/`, also run `pnpm test:matrix` and `pnpm check:bundles`.
They need network access and take a few minutes.
