# konat

See every state of every state machine on the page, and preview any of them in place.

`<Konat />` is a development overlay for React apps that use state machines. It lists each machine that runs on the page and all of its states, also the states the UI never went to. Click a state to show it in the real app, with real layout and data. You do not have to click through the flow, slow down the network, or force an API error to get there. This version supports XState v5.

- **Every state, in context.** Previews render in the running app, not in a separate story or sandbox.
- **Safe.** A preview changes only what components see. The real actor keeps running, and events that the UI sends during a preview are blocked and logged.
- **Realistic data.** Previews use context recorded from earlier visits, context you write as fixtures, or the live context. The panel shows which one it uses.
- **Gone in production.** Production builds keep a component that renders nothing and re-exports of `@xstate/react`.

## Install

```bash
npm install konat
```

konat needs `react` 18 or 19, `xstate` 5.28 or later, and `@xstate/react` 6.1 or later.

## Quick start

1. Mount the overlay once, near the root of the app:

   ```tsx
   import { Konat } from 'konat';

   export function App() {
     return (
       <>
         <Routes />
         <Konat />
       </>
     );
   }
   ```

2. Import the XState hooks from `konat/xstate` instead of `@xstate/react`. The hooks have the same names and signatures.

   ```diff
   - import { useMachine, useSelector, createActorContext } from '@xstate/react';
   + import { useMachine, useSelector, createActorContext } from 'konat/xstate';
   ```

Start the dev server and click the bubble in the bottom-right corner, or press <kbd>Alt</kbd>+<kbd>S</kbd>.

## How it works

konat has three parts: the adapter in `konat/xstate`, a registry for the page, and the overlay.

```
component ── useMachine() ──▶ proxy ──▶ real actor
                               │  ▲
                      register │  │ preview: leaves + context
                               ▼  │
                             registry ◀── overlay
```

**The adapter gives your components a proxy of each actor.** The hooks call the hooks of `@xstate/react`, and return a proxy of the actor that they make. `connect()` does the same for an actor that you create outside React. The proxy sends each call to the real actor. During a preview, `getSnapshot()`, `subscribe()` and `send()` work differently.

**One registry holds the actors of the page.** Each proxy registers its actor under a machine id and an instance id. The machine id is `machine.id`, or `debug.id` if you set it. The registry is on `globalThis`, so all React roots and all copies of konat on the page use the same registry. On the server, the registry does nothing, because one server process renders the pages of many users.

**The list of states comes from the machine.** konat reads the state nodes of the machine one time and keeps the tree. Thus, the panel can show the states that the app never went to. Each atomic or final state is a leaf that you can preview.

**A preview is a snapshot that XState makes.** When you select a leaf, the registry keeps an override for that instance: the leaves and a context. The proxy gives the leaves and the context to `machine.resolveState()`, and returns that snapshot from `getSnapshot()` and to subscribers. The components render again with a real XState snapshot, so `matches()`, `hasTag()` and `can()` work. In a parallel machine, the regions that you did not select keep their current leaf. The live child actors are copied into the preview. The real actor does not know about the preview, and continues to run.

**Events go to a log during a preview.** `send()` on the proxy, and the internal send that `sendTo()`, `forwardTo()` and delayed events use, look for an override first. If there is one, the event goes to the event log of the panel, not to the actor.

**Context comes from recordings, fixtures or the live actor.** The adapter records the context of each snapshot in memory, under its set of leaves. Each 500 ms, it writes a JSON copy of the recordings to `sessionStorage`. The limits are 50 sets of leaves for each machine, 100,000 characters for each context, and 1,000,000 characters in total. The copy does not have functions. A context that JSON cannot copy correctly, for example one with an actor ref, stays only in memory. A preview uses the recording of the same set of leaves. If there is none, it uses the most recent recording that has a selected leaf. If there is no recording, it uses a fixture, and then the live context.

**The overlay renders in a shadow root.** `<Konat />` adds a `<div data-konat-root>` to `document.body`, or to `portalTarget`. It attaches a shadow root to the `div`, puts the CSS of the overlay in it, and renders the panel there with a React portal. The CSS of the page and the CSS of the overlay cannot change each other. konat adds the `div` in a layout effect, after hydration. Thus, the server renders nothing.

**Production builds keep none of it.** Each export is `process.env.NODE_ENV !== 'production' ? <konat version> : <@xstate/react version>`. The bundler replaces `process.env.NODE_ENV` with `"production"` and removes the branch that cannot run. The package sets `"sideEffects": false`, so the bundler also removes the modules that nothing imports. `<Konat />` becomes a component that returns `null`.

## Documentation

The docs site explains the concepts, the panel, fixtures, the API, Next.js, production builds and the limitations. Its pages are in [`site/src/content/docs`](../../site/src/content/docs).

## License

MIT
