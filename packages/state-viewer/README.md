# state-viewer

See every state of every XState machine on the page, and preview any of them in place.

`<StateViewer />` is a development overlay for React apps that use XState v5. It lists each machine that runs on the
page and all of its states, also the states the UI never went to. Click a state to show it in the real app, with
real layout and data. You do not have to click through the flow, slow down the network, or force an API error to get
there.

- **Every state, in context.** Previews render in the running app, not in a separate story or sandbox.
- **Safe.** A preview changes only what components see. The real actor keeps running, and events that the UI sends
  during a preview are blocked and logged.
- **Realistic data.** Previews use context recorded from earlier visits, context you write as fixtures, or the live
  context. The panel shows which one it uses.
- **Shareable.** Copy a link that opens the page with the same previews.
- **Gone in production.** Production builds keep a component that renders nothing and re-exports of `@xstate/react`.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Concepts](#concepts)
- [Fixtures](#fixtures)
- [Deep links](#deep-links)
- [Keyboard](#keyboard)
- [API](#api)
- [Next.js and server components](#nextjs-and-server-components)
- [Production builds](#production-builds)
- [Performance in development](#performance-in-development)
- [Limitations](#limitations)
- [FAQ](#faq)

## Install

```bash
npm install state-viewer
```

state-viewer uses the versions of these packages that your app has:

| Package | Versions |
|---|---|
| `react`, `react-dom` | 18 or 19 |
| `xstate` | 5.28 or later |
| `@xstate/react` | 6.1 or later |

## Quick start

There are two changes.

1. Mount the overlay once, near the root of the app:

   ```tsx
   import { StateViewer } from 'state-viewer';

   export function App() {
     return (
       <>
         <Routes />
         <StateViewer />
       </>
     );
   }
   ```

2. Import the XState hooks from `state-viewer/xstate` instead of `@xstate/react`:

   ```diff
   - import { useMachine, useSelector, createActorContext } from '@xstate/react';
   + import { useMachine, useSelector, createActorContext } from 'state-viewer/xstate';
   ```

   The hooks have the same names and signatures as in `@xstate/react`.

Start the dev server and click the bubble in the bottom-right corner, or press <kbd>Alt</kbd>+<kbd>S</kbd>. The panel
lists each machine that a hook started. Select a state to preview it, and select it again to release it.

Actors that you create outside React, for example in a module, need one more step. Wrap them with `connect()`:

```ts
import { createActor } from 'xstate';
import { connect } from 'state-viewer/xstate';
import { sessionMachine } from '@/machines/session';

export const sessionActor = connect(createActor(sessionMachine).start(), { id: 'session' });
```

Use the actor that `connect()` returns everywhere in the app, for example with `useSelector(sessionActor, …)`.

## Concepts

**Machine and instance.** The panel groups actors by machine id, such as `checkout`. Each actor of a machine is an
instance: `checkout · 1`, `checkout · 2`. A list with one machine per row has one instance for each row.

**Leaf id.** A state is identified by the dot path to an atomic or final state, such as `payment.error`. A parallel
machine is in one leaf of each region at the same time.

**Preview.** When you select a leaf, the components that read the actor show that state. They do not mount again.
In a parallel machine, the regions that you did not touch keep their real state. The preview is a real XState
snapshot, so `matches()`, `hasTag()`, `can()` and `status` work as usual.

**The real actor keeps running.** A preview changes only what the components see. Timers, invoked promises and
callbacks continue in the real actor. When you release the preview, the components show the real state at that time,
which can be different from the state before the preview.

**Blocked events.** Events that the UI sends to a previewed actor do not get to the machine. The panel logs each one
with the state that the UI showed. Use the log to see what a button does in a state that is difficult to get to.

**Context for a preview.** A preview needs context. state-viewer looks for it in this sequence:

1. **Recorded:** the last context that the real actor had in this state. state-viewer records it on each transition
   and keeps it in `sessionStorage`, so it is still there after a reload.
2. **Fixture:** context that you wrote with `defineFixtures()`. See [Fixtures](#fixtures).
3. **Live:** the current context of the real actor. state-viewer logs a warning, because the live context often does
   not agree with the state.

The state tree marks each state with the data it has. In the panel, you can change the source of the context for
each preview.

**Child actors.** Machines that a machine invokes or spawns are listed under their parent. You can see their state,
but you cannot preview them in this version.

## Fixtures

Fixtures give context to states that you have not recorded yet, such as an error after a slow request. Put them in a
file of their own, and give `<StateViewer />` a loader for that file:

```ts
// src/debug/fixtures.ts
import { defineFixtures } from 'state-viewer/xstate';
import { checkoutMachine } from '@/machines/checkout';

const base = { items: [{ id: 'sku_1', name: 'Linen tote', price: 2400, qty: 2 }], total: 4800, cardNumber: '' };

export default [
  defineFixtures(checkoutMachine, {
    'payment.error': { context: { ...base, cardNumber: '4000 0000 0000 0002', error: 'Card declined' } },
    'payment.success': { context: { ...base, receiptId: 'rcpt_123' } },
  }),
];
```

```tsx
// The condition removes the fixtures, and the import, from production builds.
const fixtures = process.env.NODE_ENV !== 'production' ? () => import('@/debug/fixtures') : undefined;

<StateViewer fixtures={fixtures} />;
```

In Vite, you can use `import.meta.env.DEV` as the condition.

- The keys are leaf ids. TypeScript checks them against the states of the machine, and `context` against the context
  type of the machine.
- A fixture set applies to each instance of its machine, also to copies from `machine.provide()`, and to machines that
  `debug.id` renames.
- The loader runs after the page loads. Previews that started before it finished, such as previews from a deep link,
  change to the fixture when it arrives. Such a preview logs the warning about the live context only if the loader
  gives no fixture for it.
- In a parallel preview, the first leaf that has a fixture gives the context: the leaves you selected, in sequence,
  then the leaves of the other regions.
- You can give an array of sets in place of a loader. Then the sets are in your main bundle, also in production.
  Use a loader with a development check to keep them out.

## Deep links

**Copy link** in the panel writes a URL that opens the page with the same previews:

```
http://localhost:5173/checkout?debug-state=checkout:payment.error;shipping.express,session:expired
```

- `:` separates the machine id from its leaves, `;` separates the leaves of a parallel machine, and `,` separates
  machines.
- A link applies to each instance of a machine when it registers. A machine on a different page gets the preview when
  you go to that page. This continues until you preview or release that machine in the panel.
- A link does not include context. The preview finds its context as usual, from a recording, a fixture or the live
  context.
- To use a different query parameter, set `urlParam`.

## Keyboard

| Keys | Where | Action |
|---|---|---|
| <kbd>Alt</kbd>+<kbd>S</kbd> | Anywhere | Open or close the panel |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Panel | Go to the previous or next state |
| <kbd>Home</kbd> / <kbd>End</kbd> | Panel | Go to the first or last state |
| <kbd>Enter</kbd> | Panel | Preview or release the state |
| <kbd>Esc</kbd> | Panel | Release all previews |
| <kbd>[</kbd> / <kbd>]</kbd> | Panel | Go to the previous or next machine |

The shortcuts do nothing while you type in an input, a text area or an editable element. To change the toggle
shortcut, set `shortcut`.

## API

### `<StateViewer />` from `state-viewer`

```tsx
<StateViewer
  position="bottom-right"    // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  defaultOpen={false}        // Open the panel on the first visit.
  theme="system"             // 'system' | 'light' | 'dark'
  shortcut="alt+s"           // For example 'ctrl+shift+d'. false turns the shortcut off.
  urlParam="debug-state"     // The query parameter of deep links.
  fixtures={loader}          // Fixture sets, or a function that loads them.
  portalTarget={undefined}   // The element that gets the overlay. The default is document.body.
/>
```

All props are optional. The panel keeps its open state, its corner and the selected machine in `localStorage`, so
`position` and `defaultOpen` apply only until the user changes them.

The overlay renders in a shadow root, so the styles of the page do not change it, and its styles do not change the
page.

### `state-viewer/xstate`

| Export | What it is |
|---|---|
| `useMachine(machine, options?)` | Same as `@xstate/react`. Returns `[snapshot, send, actorRef]`. |
| `useActor(logic, options?)` | Same as `@xstate/react`. Returns `[snapshot, send, actorRef]`. |
| `useActorRef(logic, options?, observer?)` | Same as `@xstate/react`. Returns the actor. |
| `createActorContext(logic, options?)` | Same as `@xstate/react`. Its `Provider` creates the actor. |
| `useSelector`, `shallowEqual` | Re-exports of `@xstate/react`. They work with each actor from this package. |
| `connect(actor, debug?)` | Registers an actor that you created outside React. Returns the actor to use in the app. |
| `defineFixtures(machine, states)` | Makes a fixture set for `<StateViewer fixtures>`. |

The hooks and `createActorContext` accept one more option, `debug`. state-viewer removes it before the options get to
XState. `connect()` takes the same object as its second argument.

```ts
type DebugOptions = {
  id?: string;        // The machine id in the panel and in deep links. The default is machine.id.
  label?: string;     // The name of the instance in the panel.
  disabled?: boolean; // Keep this actor out of state-viewer.
};

const [snapshot, send] = useMachine(checkoutMachine, { input, debug: { label: 'Checkout (modal)' } });
```

Give each machine an `id`. A machine without one has the XState default id `(machine)`. state-viewer then makes an id
from the states and context keys of the machine, and logs a warning once. That id changes when you add or remove
states or context keys, so links to the machine stop working after such a change.

The actors that the hooks return are proxies of the real actors. They have the same interface. `actorRef.send()`
goes to the real actor when nothing is previewed.

## Next.js and server components

Both entries start with `'use client'`, so you can import them in the App Router.

- A server component can render `<StateViewer />`, for example in the root layout.
- A server component cannot give a function to a client component, so it cannot give the `fixtures` loader. Render
  `<StateViewer fixtures={…} />` in a client component, and render that component in the layout:

  ```tsx
  // src/components/DevTools.tsx
  'use client';

  import { StateViewer } from 'state-viewer';

  const fixtures = process.env.NODE_ENV !== 'production' ? () => import('@/debug/fixtures') : undefined;

  export function DevTools() {
    return <StateViewer fixtures={fixtures} />;
  }
  ```

- Call the hooks and `createActorContext()` only in client components, as with `@xstate/react`.
- On the server, state-viewer does nothing: the overlay renders nothing, and nothing registers. The overlay mounts
  after hydration, so it does not cause hydration errors. A deep link applies in the browser.

In a monorepo that gives the TypeScript source of state-viewer, add it to `transpilePackages`.

## Production builds

In production builds, `<StateViewer />` renders nothing, the hooks are the hooks of `@xstate/react`, and the registry,
the overlay and the adapter are removed from the bundle. You do not have to remove the overlay or change the imports
before a release.

This needs a bundler that replaces `process.env.NODE_ENV` with `"production"`. Vite, Next.js (webpack and Turbopack)
and React Router do this. With esbuild, add `--define:process.env.NODE_ENV='"production"'`. The package sets
`"sideEffects": false`, so the bundler can remove the modules that nothing uses.

The repository has a check for this (`pnpm check:bundles`). It packs the package as npm publishes it, builds an app
with each of these bundlers, and looks for debug code in the output. With esbuild and Vite, the JavaScript that the
app loads at startup is approximately 150 to 160 bytes (gzip) larger than the same app with `@xstate/react`.

Put a development check on the fixtures loader, as in the examples above. Without the check, the fixtures are a chunk
that the production app never loads, but the build still makes it.

## Performance in development

When the panel is closed, the overlay itself costs almost nothing. The adapter costs a small amount: it registers each
actor, records its context, and passes snapshots through a proxy. These numbers are from the benchmarks in `bench/`,
in jsdom with StrictMode. Compare the rows, not the absolute times.

| Work | `@xstate/react` | `state-viewer/xstate` |
|---|---|---|
| A transition that renders a `useMachine` component again | 27 µs | 34 µs |
| Mount and unmount 50 rows, each with `useMachine` | 1.0 ms | 2.1 ms |
| 100 events to an actor outside React (`connect()`) | 0.17 ms | 0.22 ms |

Thus, a transition costs approximately 8 µs more, a mount approximately 22 µs more, and an event to a `connect()`ed
actor less than 1 µs more. Production builds do not have this cost.

## Limitations

- **Effects in the machine do not run during a preview.** Invoked actors, delayed transitions and entry actions of the
  previewed state do not start. Effects in components that react to the state, such as a `useEffect` that depends on
  `snapshot.value`, do run.
- **Only actors from `state-viewer/xstate` or `connect()` are listed.** An actor from `createActor()` that you do not
  give to `connect()` is not in the panel.
- **Child actors are read-only.** You can see them, but you cannot preview them. A preview keeps the live children in
  `snapshot.children`, so components that read them continue to work. This part is experimental.
- **History states cannot be selected.**
- **Releasing shows the real state at that time.** The real actor kept running during the preview.
- **Deep links have no context, and apply to machines, not instances.** Each instance of a linked machine gets the same
  preview.
- **Some routers break deep links.** A router that parses and builds the query string again can break a link whose
  machine id contains `:`, or whose leaf ids contain `;`, `,` or `%`.
- **Functions in context are not recorded across reloads.** After a reload, a recorded preview does not have them.
- **A transform on `body` moves the overlay.** If `body` has a `transform`, a `filter` or `contain`, it becomes the
  containing block of the overlay. Use `portalTarget={document.documentElement}` on such pages.
- **A `connect()`ed actor that fails stays in the panel until the page reloads.** So does one that you stop through
  the actor itself, not its proxy, before it starts. XState reports nothing in that case.
- **The arrow keys move through leaves only.** Compound and parallel states cannot get focus.
- **The state tree shows the fixtures of the first instance of a machine id.** Another instance with the same id, but
  with a changed machine config, for example after a Fast Refresh edit, can get other fixtures.
- **Around a preview, observers can get a snapshot one more or one less time than with `@xstate/react`.** Without a
  preview, an observer given to a hook gets the same calls as with `@xstate/react`. A few rare sequences around a
  preview, such as a Fast Refresh edit or an `<Activity>` that hides the component, can give it one more, one less or
  a later snapshot. The number of `complete` and `error` calls stays the same. An observer also gets the preview again
  each time the preview is built again. That happens when its live children change, when fixtures load, or when an
  edit adds a region.
- **Development builds only.** For staging builds in production mode, the overlay is not available.

## FAQ

**My machine is not in the panel. Why?**
Make sure that the component imports the hook from `state-viewer/xstate`, not from `@xstate/react`, and that
`<StateViewer />` is mounted. An actor that you create with `createActor()` must go through `connect()`. An actor with
`debug: { disabled: true }` is not listed.

**Can a preview change my data or call my API?**
No. The real actor does not change, and events that the UI sends during a preview are blocked. Effects in components
still run, for example a `useEffect` that fetches when a state shows. They run as they do when the real machine is in
that state.

**Why does a preview show the wrong data?**
The state had no recording and no fixture, so the preview uses the live context. The console shows a warning, and the
state tree marks the state. Go to the state once in the real app, or write a fixture for it.

**Does it work with React 18 and StrictMode?**
Yes. The test suite runs on React 18 and 19, with StrictMode on.

**Does it work with `useReducer`, Zustand or other state libraries?**
Not in this version. XState machines declare their states, so state-viewer can list states that the UI never went to.
Support for other libraries is on the roadmap.

**Does it work with XState v4 or v6?**
No. It works with XState v5 only. Support for v6 will come when v6 is stable.

**Can I use it in a staging build?**
Not in this version. It works only in development builds.

**Two copies of state-viewer are in my bundle. Is that a problem?**
No. All copies use one registry on `globalThis`. If the versions are different, the console shows a warning.

## License

To be decided before the first release.
