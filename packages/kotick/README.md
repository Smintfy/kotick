# kotick

See every state of every state machine on the page, and preview any of them in place.

`<Kotick />` is a development overlay for React apps that use state machines. It lists each machine that runs on the page and all of its states, also the states the UI never went to. Click a state to show it in the real app, with real layout and data. You do not have to click through the flow, slow down the network, or force an API error to get there. kotick supports XState v5 machines through `kotick/xstate`, and `useReducer` machines through `kotick/reducer`. Neither adapter is the default.

- **Every state, in context.** Previews render in the running app, not in a separate story or sandbox.
- **Safe.** A preview changes only what components see. The real machine keeps running, and events that the UI sends during a preview are blocked and logged.
- **Realistic data.** Previews use context recorded from earlier visits, context you write as fixtures, or the live context. The panel shows which one it uses.
- **No panel in production.** `<Kotick />` renders nothing in a production build, and the registry and the panel are removed from the bundle. With `kotick/xstate`, production builds keep re-exports of `@xstate/react`. With `kotick/reducer`, they keep a small runtime that runs your transitions and effects.

## Install

For XState machines:

```bash
npm install kotick xstate @xstate/react
```

For `useReducer` machines:

```bash
npm install kotick
```

kotick needs `react` 18 or 19. `kotick/xstate` also needs `xstate` 5.28 or later and `@xstate/react` 6.1 or later. kotick does not install them. If your app already has them, install only `kotick`. `kotick/reducer` needs neither of them. An app can use both adapters.

Add kotick to `dependencies`, not to `devDependencies`. Your app code imports `kotick/xstate` or `kotick/reducer`, thus the production build needs the package.

## Quick start

1. Mount the overlay once, near the root of the app. Both adapters use the same overlay:

   ```tsx
   import { Kotick } from 'kotick';

   export function App() {
     return (
       <>
         <Routes />
         <Kotick />
       </>
     );
   }
   ```

2. Connect your machines through the adapter.

   For XState machines, import the hooks from `kotick/xstate` instead of `@xstate/react`. The hooks have the same names and signatures.

   ```diff
   - import { useMachine, useSelector, createActorContext } from '@xstate/react';
   + import { useMachine, useSelector, createActorContext } from 'kotick/xstate';
   ```

   For `useReducer` machines, declare the reducer as a machine with `defineReducerMachine` from `kotick/reducer`. Then call `useMachineReducer` instead of `useReducer`.

   ```diff
   - const [state, dispatch] = useReducer(reducer, { status: 'idle' });
   + const [state, dispatch] = useMachineReducer(searchMachine, { status: 'idle' });
   ```

Start the dev server and click the bubble in the bottom-right corner, or press <kbd>Alt</kbd>+<kbd>S</kbd> (<kbd>⌥S</kbd> on macOS).

## How it works

kotick has three parts: an adapter for each kind of machine, a registry for the page, and the overlay. The adapters are `kotick/xstate` and `kotick/reducer`.

```
component ── useMachine() ──▶ proxy ──▶ real actor
                               │  ▲
                      register │  │ preview: leaves + context
                               ▼  │
                             registry ◀── overlay
```

**The XState adapter gives your components a proxy of each actor.** The hooks call the hooks of `@xstate/react`, and return a proxy of the actor that they make. `connect()` does the same for an actor that you create outside React. The proxy sends each call to the real actor. During a preview, `getSnapshot()`, `subscribe()` and `send()` work differently.

**The reducer adapter keeps the state in React.** `useMachineReducer` runs the reducer of the machine in React's `useReducer`, and runs the effect of the real state. In development, it also registers the instance, records its state object after each commit, and returns the state object of a preview in place of the real one.

**One registry holds the instances of the page.** Each proxy, and each component that calls `useMachineReducer`, registers under a machine id and an instance id. The machine id is `machine.id`. For an XState machine, `debug.id` replaces it if you set it. The registry is on `globalThis`, so all React roots and all copies of kotick on the page use the same registry. On the server, the registry does nothing, because one server process renders the pages of many users.

**The list of states comes from the machine.** kotick reads the state nodes of an XState machine one time and keeps the tree. A reducer machine names its states in `states`. Thus, the panel can show the states that the app never went to. Each atomic or final state is a leaf that you can preview.

**A preview of an XState machine is a snapshot that XState makes.** When you select a leaf, the registry keeps an override for that instance: the leaves and a context. The proxy gives the leaves and the context to `machine.resolveState()`, and returns that snapshot from `getSnapshot()` and to subscribers. The components render again with a real XState snapshot, so `matches()`, `hasTag()` and `can()` work. In a parallel machine, the regions that you did not select keep their current leaf. The live child actors are copied into the preview. The real actor does not know about the preview, and continues to run.

**A preview of a reducer machine is a state object.** The context of a reducer state is the whole state object, so the hook returns the recorded or fixture object of the selected state. The live state object fits only the state that the machine is in. Thus, you cannot preview another state that has no recording and no fixture.

**Events go to a log during a preview.** `send()` on the proxy, the internal send that `sendTo()`, `forwardTo()` and delayed events use, and the `dispatch` of `useMachineReducer` look for an override first. If there is one, the event goes to the event log of the panel, not to the machine. The `send` of a reducer machine's effect is never blocked.

**Context comes from recordings, fixtures or the live machine.** The adapter records the context of each snapshot in memory, under its set of leaves. Each 500 ms, it writes a JSON copy of the recordings to `sessionStorage`. The limits are 50 sets of leaves for each machine, 100,000 characters for each context, and 1,000,000 characters in total. The copy does not have functions. A context that JSON cannot copy correctly, for example one with an actor ref, stays only in memory. A preview uses the recording of the same set of leaves. If there is none, it uses the most recent recording that has a selected leaf. If there is no recording, it uses a fixture. An XState machine then uses the live context.

**The overlay renders in a shadow root.** `<Kotick />` adds a `<div data-kotick-root>` to `document.body`, or to `portalTarget`. It attaches a shadow root to the `div`, puts the CSS of the overlay in it, and renders the panel there with a React portal. The CSS of the page and the CSS of the overlay cannot change each other. kotick adds the `div` in a layout effect, after hydration. Thus, the server renders nothing.

**Production builds keep none of the debugger.** Each export of `kotick/xstate` is `process.env.NODE_ENV !== 'production' ? <kotick version> : <@xstate/react version>`. The bundler replaces `process.env.NODE_ENV` with `"production"` and removes the branch that cannot run. The package sets `"sideEffects": false`, so the bundler also removes the modules that nothing imports. `<Kotick />` becomes a component that returns `null`. `kotick/reducer` keeps a small runtime that runs your transitions and effects, and drops the registry, the recordings and the fixtures.

## Documentation

The docs site explains the concepts, reducer machines, the panel, fixtures, the API, Next.js and the limitations. Its pages are in [`site/src/content/docs`](https://github.com/Smintfy/kotick/tree/main/site/src/content/docs).

## License

MIT
