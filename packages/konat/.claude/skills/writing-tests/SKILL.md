---
name: writing-tests
description: This skill should be used when writing, changing, porting or reviewing a test in packages/konat, or when oxlint flags a test file there. It covers black-box tests through the public entries, the ban on mocks, exact assertions and file layout.
---

# Writing tests for konat

A test uses konat the way an app does, and asserts what a developer sees. It fails when the behavior breaks,
and it passes through any refactor that keeps the behavior. oxlint enforces the mechanical part of these rules on every
test file.

## Rules

1. **Import the package by name.** Import `konat`, `konat/xstate` and `konat/reducer`, the entries an app imports.
   Never import from `src/`. If a private function seems to need its own test, find what a developer sees through
   it, and test that.
2. **Use no mocks.** No `vi.mock`, `vi.fn`, `vi.spyOn`, stubbed globals, fake timers, or hand-built stand-ins for
   XState, React or a browser API. Run the real code.
   - To record the calls of a callback, push each call into an array, then assert the array.
   - To read console output, call `watchConsole()` from `test/support/console.ts`. It replaces nothing.
   - To start delayed work, fire the real trigger, such as a `pagehide` event, or wait for real time.
   - To change the environment, configure it as a page or a server would, such as `// @vitest-environment node`.
3. **Drive it like a developer.** Render components that call the hooks next to the overlay with `page()` or `mount()`
   from `test/support/app.tsx`, and click their buttons with `press()`. Drive the overlay with `test/support/panel.ts`:
   `show()`, `preview()`, `pickSource()` and `release()`. Read the result from the DOM: what the components render,
   `panel()` and `isOpen()`. Find an overlay element by its role, its `aria-*` or `data-*` attributes, or its
   `data-part`, never by a class. The classes are Tailwind utilities, and they change with the styles.
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
   registry. The fallback-id and shortcut warnings print once per page for each value, so a test that expects one
   uses a value of its own.
8. **Keep the suite minimal.** Add a test only for a behavior that a developer would notice when it breaks, and that
   no other test guards already. Test the layers that branch, such as parsing, state resolution and lifecycle races,
   and leave thin wiring to the tests of what it wires. Put the inputs of one behavior in one `test.each` table. Don't
   test what XState, React or `@xstate/react` do without konat, and don't test what TypeScript or oxlint rejects.

## Where tests go

| Path | Contents |
|---|---|
| `test/<feature>.test.tsx` | One user-visible feature, such as `preview`, `keyboard` or `server` |
| `test/<feature>/<condition>.test.tsx` | A feature whose conditions outgrow one file, such as `observers`. Each condition gets a file, with its plainest case first |
| `test/<feature>.test-d.ts` | Type tests of the public API |
| `test/support/` | Helpers. They use the public entries, React, XState, Testing Library, Node built-ins and the DOM, never `src/` or the registry |
| `test/setup.ts` | StrictMode for every render, and a clean page for every test |

Before you add a file, look for the feature's file or folder. Add the test there.

## Hard cases

These techniques replace a mock. Each one was tried in this package.

- **Console output.** `watchConsole()` subscribes to Node's `console.warn` and `console.error` diagnostics channels.
- **React errors in an error boundary.** Pass `onCaughtError` to `render()`, and record the errors it receives. React
  18's `render()` has no `onCaughtError`, so a test that also runs on React 18 wraps the component in `Boundary` from
  `test/support/boundary.tsx`, and reads what it caught with `alerts()`.
- **Errors that XState throws from a timer.** Call `uncaught(run)` from `test/support/console.ts`. It adds a
  `process.on('uncaughtException')` listener, runs `run`, waits one real tick, removes the listener, and returns the
  errors.
- **Recordings in sessionStorage.** Dispatch a `pagehide` event on `window` to write them at once, under
  `konat:recorded:<machine id>` as `{"v":1,"entries":[{"leaves","at","context"}]}`. Assert that `at` lies
  between two `Date.now()` reads. `test/setup.ts` dispatches one after each test, so a pending write can't land in the
  next test. The page also writes them 500 ms after the first visit, and under load the presses of a test can take
  longer than that. When a test asserts what one write stores or warns, make the visits and the `pagehide` in one task.
  Click them with `clickInSameTask()` from `test/recording.test.tsx`, which doesn't wait for React. To test the 500 ms
  delay, wait for real time, and run each step in a timer with `after()` from the same file. Node runs due timers in
  the order of their deadlines, also when the page runs late.
- **An actor that the page must let go.** Hold it only in a `WeakRef`, and call `collected()` from
  `test/support/gc.ts`. It runs three rounds of one real tick and a full collection, then tells which targets are gone.
  Never call `deref()` before it, because a `WeakRef` keeps the target it gave back alive until the task ends. The
  overlay keeps its last render until it renders again, so unmount it before the check. A check that expects `true`
  passes when nothing holds the actor, so break the release in `src/` once, and watch it fail.
- **A reload.** Store a payload for a machine id that has not mounted yet, then render it. The page reads the stored
  recordings when the machine first registers.
- **A full storage.** Fill `sessionStorage` with app data up to the 5,000,000-character quota of jsdom, or set
  `// @vitest-environment-options {"storageQuota":0}` for the whole file.
- **No storage at all.** Call `window.jsdom.reconfigure({ url: 'about:blank' })` before the first render. Both
  storages then throw. `test/setup.ts` clears the storage before each test, which then throws too, so such a file
  holds one test, as `test/blocked-storage.test.tsx` does.
- **Copy JSON.** jsdom has no clipboard and no `execCommand`, so the overlay copies through a textarea in its shadow
  root and shows "Copy failed". `copy()` in `test/support/panel.ts` observes the shadow root with a `MutationObserver`
  and returns the value of each textarea the overlay adds.
- **A click that changes the panel's page inside another `act()`.** React 18 shows the new page only when the outer
  `act()` ends, so a step inside `uncaught()` can't go from the machine list to a machine page. `show()` stays on a
  machine page that shows already, so call it before such a step.
- **Stored panel settings.** Fill localStorage `konat:ui` before the render, such as
  `{"v":1,"open":true,"position":"top-left","positionDefault":"bottom-right","machine":"checkout"}`. The overlay reads
  it when it mounts.
- **An edit to a machine, as Fast Refresh makes it.** jsdom has no React Refresh. Make the machine in a function, and
  `rerender()` the app with a machine that the function makes again, with the same id. @xstate/react starts the new
  actor from the old one's snapshot, so the live state carries over, as it does in the browser.
- **The first paint.** Mount with `createRoot` and without `act`: set `IS_REACT_ACT_ENVIRONMENT` to false for the
  mount. Read the DOM in a microtask that a layout effect queues, at the end of the task that commits the mount, where
  the browser paints. StrictMode can hide a late update, so also mount without it.
- **`<Activity>`.** React 18 has no `React.Activity`, so put its tests in `describeWithActivity` from
  `test/support/react.ts`, and read `React.Activity` as a property, so the file loads on React 18. A hidden Activity runs
  the cleanup of its components' effects, so their instances unregister until it shows them again.
- **The real actor moves on during a preview.** A preview blocks the events that the app sends through the hook's
  actor. Send to the real actor instead: give `useMachine` a `systemId` and call `actor.system.get(systemId).send()`,
  or start the actor in the test, show `connect(actor)`, and send to `actor`.
- **A lazy fixtures loader.** Pass `fixtures={() => loaded}`, where `loaded` is a promise that the test resolves or
  rejects, as `() => import('./fixtures')` does. Resolve it with `{ default: sets }` inside `act()`. `lazyFixtures()`
  from `test/support/app.tsx` gives such a loader.
- **A second copy of the package.** `vi.resetModules()` replaces nothing, so it is allowed. Import the entry again.
- **Production builds.** `test/production.test.tsx` runs in its own Vitest project, `production` in
  `vitest.config.ts`, with `test.env.NODE_ENV` set to `'production'`. Vite's `define` doesn't change `NODE_ENV` in
  tests. The project also sets `oxc: { jsx: { development: false } }`, because production React has no `jsxDEV`. React
  has no `act` in production, so render with `createRoot`, wait for real time, and click with `element.click()`, because
  Testing Library's events go through `act`.
- **XState's production build.** An app that a bundler builds without the development condition, such as esbuild, gets
  XState's production build next to the package's development code. That build gives no snapshot while an actor is
  created, where the development build throws. `test/xstate-production.test.tsx` runs in its own Vitest project,
  `xstate-production`, which imports `xstate` from its production entry. Vitest adds the development condition to every
  project, so the project sets an alias, not a condition. `@xstate/react` still gets the development build there, so
  put no hook test in that file.
