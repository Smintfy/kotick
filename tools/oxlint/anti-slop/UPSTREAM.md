# Vendored anti-slop

Source: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), commit `13909c9e07590f5a85d93c62712259fe14a883f7` (2026-10-13).

The files are the skill bundle at `skills/install-anti-slop/assets/anti-slop/` of that commit.
That bundle is `src/` without the `*.test.ts` files.
`scripts/install.mjs` of the same skill copied them here without changes.

## Installed paths

- `index.ts`, `rules/` and `shared/` are the generic plugin. `.oxlintrc.json` registers it as `anti-slop` and enables all of its rules.
- `effect/` is the Effect plugin. No package in this repository depends on `effect`, so `.oxlintrc.json` does not register it.
- `vendor/eslint-stylistic/` is the engine of `require-readable-spacing`. It has its own `LICENSE` and `UPSTREAM.md`.
- `LICENSE` is the MIT license of anti-slop, copied from the root of the source repository.

## Local changes

None.
The root `package.json` pins `oxlint` and `@oxlint/plugins` to the same exact version, so an upgrade moves the two together.

## Updating

Use the `install-anti-slop` skill of the source repository, and give it this file.
It compares the commit above with the new upstream commit and keeps the local changes.
