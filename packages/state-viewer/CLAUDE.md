# state-viewer

A development overlay for React apps that use XState v5. The README says what it does for a developer.

## Layout

| Path | Contents |
|---|---|
| `src/index.tsx` | The `state-viewer` entry: `<StateViewer />` and its types |
| `src/xstate.ts` | The `state-viewer/xstate` entry: the hooks, `connect()`, `defineFixtures()` and their types |
| `src/core/` | The registry, one per page, and the stores it composes. `types.ts` is what the other two layers share |
| `src/overlay/` | The overlay. `StateViewer.tsx` mounts it in a shadow root. The other root modules hold what the components use |
| `src/overlay/components/` | The React components in the shadow root |
| `src/xstate/` | The adapter. The hooks and `connect()` give the app a proxy of each actor, and give the registry a handle |
| `test/<feature>.test.tsx` | Black-box tests, one feature per file |
| `test/<feature>/` | A feature whose conditions outgrow one file, one file per condition, such as `test/observers/` |
| `test/support/` | Helpers for those tests |
| `test/xstate/`, `test/regressions/` | Legacy tests. They move into feature files |

The overlay and the adapter never import each other.
`pnpm lint` enforces the layers and what each entry exports. Its message says where an import belongs.

## Tests

Read the writing-tests skill in `.claude/skills/` before you write, change or review a test.

## Checks

The repository has no CI. Before a commit, run `pnpm typecheck` and `pnpm test` from its root.
`pnpm test` runs `pnpm lint` first.
After a change to `src/`, also run `pnpm test:matrix` and `pnpm check:bundles`.
They need network access and take a few minutes.
