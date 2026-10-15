---
name: writing-tests
description: This skill should be used when writing, changing, porting or reviewing a test in packages/state-viewer, or when oxlint flags a test file there. It covers black-box tests through the public entries, the ban on mocks, exact assertions, file layout, and the legacy list.
---

# Writing tests for state-viewer

A test uses state-viewer the way an app does, and asserts what a developer sees. It fails when the behavior breaks,
and it passes through any refactor that keeps the behavior. oxlint enforces the mechanical part of these rules on every
test file that is not on the legacy list.

## Rules

1. **Import the package by name.** Import `state-viewer` and `state-viewer/xstate`, the entries an app imports. Never
   import from `src/`. If a private function seems to need its own test, find what a developer sees through it, and
   test that.
2. **Use no mocks.** No `vi.mock`, `vi.fn`, `vi.spyOn`, stubbed globals, fake timers, or hand-built stand-ins for
   XState, React or a browser API. Run the real code.
   - To record the calls of a callback, push each call into an array, then assert the array.
   - To read console output, call `watchConsole()` from `test/support/console.ts`. It replaces nothing.
   - To start delayed work, fire the real trigger, such as a `pagehide` event, or wait for real time.
   - To change the environment, configure it as a page or a server would, such as `// @vitest-environment node`.
3. **Drive it like a developer.** Render components that call the hooks, click their buttons, and drive the overlay
   with `test/support/panel.ts`: `show()`, `preview()`, `pickSource()` and `release()`. Read the result from the DOM:
   what the components render, `panel()` and `isOpen()`. When a hook must behave like the `@xstate/react` hook of the
   same name, run the test against both with `describe.each`.
4. **Assert exact values.** Collect what one step shows into one object, and compare it with `toEqual` against a
   literal. Never use `toBeDefined`, `toBeTruthy`, `toBeFalsy` or `expect.anything()`. Prefer a whole value to
   `toMatchObject`, `toContain` or `stringContaining`.
5. **Make the test fail once.** Before you commit, break the behavior the test covers. For example, return early from
   the preview or delete the warning. The test must fail. If it still passes, it asserts nothing, so fix it.
6. **Write one feature per file, with the happy path first.** The first test shows the main use of the feature with no
   special conditions. Corner cases follow, in `describe` blocks named after the condition. A regression is a corner
   case in the file of its feature. Name it after the behavior, never after the bug or an issue number.
7. **Keep tests apart with fresh ids.** The page keeps one registry for each test file, so give each machine
   `id: freshId('name')`. `test/setup.ts` clears the storage and the URL before each test. Never read or reset the
   registry. A warning prints once per page for each id or value, so a test that expects one uses a value of its own.

## Where tests go

| Path | Contents |
|---|---|
| `test/<feature>.test.tsx` | One user-visible feature, such as `preview`, `keyboard` or `server` |
| `test/<feature>.test-d.ts` | Type tests of the public API |
| `test/support/` | Helpers. They use the public entries, React, XState, Testing Library, Node built-ins and the DOM, never `src/` or the registry |
| `test/setup.ts` | StrictMode for every render, and a clean page for every test |

Before you add a file, look for the feature's file. Add the test there.

## Hard cases

These techniques replace a mock. Each one was tried in this package.

- **Console output.** `watchConsole()` subscribes to Node's `console.warn` and `console.error` diagnostics channels.
- **React errors in an error boundary.** Pass `onCaughtError` to `render()`, and record the errors it receives.
- **Errors that XState throws from a timer.** Add a `process.on('uncaughtException')` listener in the test, wait one
  real tick, and remove the listener.
- **A full storage.** Fill `sessionStorage` with app data up to the 5,000,000-character quota of jsdom, or set
  `// @vitest-environment-options {"storageQuota":0}` for the whole file.
- **No storage at all.** Call `window.jsdom.reconfigure({ url: 'about:blank' })` before the first render. Both
  storages then throw.
- **Copy link and Copy JSON.** jsdom has no clipboard and no `execCommand`, so the overlay copies through a textarea in
  its shadow root and shows "Copy failed". `copy()` in `test/support/panel.ts` observes the shadow root with a
  `MutationObserver` and returns the value of each textarea the overlay adds.
- **Stored panel settings.** Fill localStorage `state-viewer:ui` before the render, such as
  `{"v":1,"open":true,"position":"top-left","positionDefault":"bottom-right","machine":"checkout"}`. The overlay reads
  it when it mounts.
- **An edit to a machine, as Fast Refresh makes it.** jsdom has no React Refresh. Make the machine in a function, and
  `rerender()` the app with a machine that the function makes again, with the same id. @xstate/react starts the new
  actor from the old one's snapshot, so the live state carries over, as it does in the browser.
- **A deep link.** Call `history.replaceState(null, '', '/?debug-state=<id>:<leaf>')` before the render, and give the
  machine a fresh id. The overlay applies each search once per page, so a test never reuses another test's link.
- **The first paint.** Mount with `createRoot` and without `act`: set `IS_REACT_ACT_ENVIRONMENT` to false for the
  mount. Read the DOM in a microtask that a layout effect queues, at the end of the task that commits the mount, where
  the browser paints. StrictMode can hide a late update, so also mount without it.
- **`<Activity>`.** React 18 has no `React.Activity`, so put its tests in `describe.runIf('Activity' in React)`. A hidden
  Activity runs the cleanup of its components' effects, so their instances unregister until it shows them again.
- **The real actor moves on during a preview.** A preview blocks the events that the app sends through the hook's
  actor. Send to the real actor instead: give `useMachine` a `systemId` and call `actor.system.get(systemId).send()`,
  or start the actor in the test, show `connect(actor)`, and send to `actor`.
- **A lazy fixtures loader.** Pass `fixtures={() => loaded}`, where `loaded` is a promise that the test resolves or
  rejects, as `() => import('./fixtures')` does. Resolve it with `{ default: sets }` inside `act()`.
- **A second copy of the package.** `vi.resetModules()` replaces nothing, so it is allowed. Import the entry again.
- **Production builds.** `test/production.test.tsx` runs in its own Vitest project, `production` in
  `vitest.config.ts`, with `test.env.NODE_ENV` set to `'production'`. Vite's `define` doesn't change `NODE_ENV` in
  tests. The project also sets `oxc: { jsx: { development: false } }`, because production React has no `jsxDEV`. React
  has no `act` in production, so render with `createRoot`, wait for real time, and click with `element.click()`, because
  Testing Library's events go through `act`.

## The legacy list

The last override in `.oxlintrc.json` lists test files written before these rules. They read private state and use
mocks. Never add a file to that list. When you change a legacy test, move the behavior it covers into the feature's
file under these rules, and delete the old test. When a legacy file is empty, delete the file and its line.
