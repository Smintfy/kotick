# kotick

See every state of every state machine on the page, and preview any of them in place.

`<Kotick />` is a development overlay for React apps that use state machines. It lists each machine that runs on the page and every state in its definition, including the states that you have not visited. Click a state to show it in the real app, with real layout and data. You do not have to click through the flow, slow down the network, or force an API error to get there.

kotick supports `useReducer` machines through `kotick/reducer`, and XState v5 machines through `kotick/xstate`. An app can use both.

- **In context.** Previews render in the running app, not in a separate story or sandbox.
- **Blocked events.** A preview changes only what components see. The real machine keeps running, and kotick blocks and logs the events that the UI sends during a preview.
- **Realistic data.** Previews use context recorded from earlier visits, context you write as fixtures, or the live context. The panel shows which one it uses.
- **No panel in production.** `<Kotick />` renders nothing in a production build, and the bundler removes the registry and the panel.

The docs are at [kotick.smintfy.com](https://kotick.smintfy.com).

## Install

For `useReducer` machines:

```bash
npm install kotick
```

`kotick/reducer` needs only React. Your app does not need `xstate` or `@xstate/react`.

For XState machines:

```bash
npm install kotick xstate @xstate/react
```

`xstate` and `@xstate/react` are optional peer dependencies, so kotick does not install them. If your app already has them, install only `kotick`. This command also covers an app that uses both adapters.

Add kotick to `dependencies`, not to `devDependencies`. Your app code imports `kotick/reducer` or `kotick/xstate`, so the production build needs the package.

### Requirements

kotick uses the versions of these packages that your app has:

| Package | Versions | Needed for |
|---|---|---|
| `react`, `react-dom` | 18 or 19 | Both adapters |
| `xstate` | 5.28 or later | `kotick/xstate` only |
| `@xstate/react` | 6.1 or later | `kotick/xstate` only |

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

   For `useReducer` machines, declare the reducer as a machine with `defineReducerMachine`. Then call `useMachineReducer` instead of `useReducer`:

   ```diff
   - const [state, dispatch] = useReducer(reducer, { status: 'idle' });
   + const [state, dispatch] = useMachineReducer(searchMachine, { status: 'idle' });
   ```

   [Convert a switch reducer](https://kotick.smintfy.com/docs/reducer#convert-a-switch-reducer) shows how to convert a reducer into a machine.

   For XState machines, import the XState hooks from `kotick/xstate` instead of `@xstate/react`:

   ```diff
   - import { useMachine, useSelector, createActorContext } from '@xstate/react';
   + import { useMachine, useSelector, createActorContext } from 'kotick/xstate';
   ```

   The hooks have the same names and signatures as in `@xstate/react`. Actors that you create outside React also need `connect()`, as [Actors outside React](https://kotick.smintfy.com/docs/xstate#actors-outside-react) shows. To find the old imports, add the lint rule in [Prevent imports from @xstate/react](https://kotick.smintfy.com/docs/xstate#prevent-imports-from-xstatereact).

3. Start the dev server, and click the bubble in the bottom-right corner, or press <kbd>Alt</kbd>+<kbd>S</kbd> (<kbd>⌥S</kbd> on macOS). The panel lists each machine that runs on the page. Select a machine to see its states. Select a state to preview it, and select it again to release it.

## Before you deploy

You do not have to remove `<Kotick />` or change the imports before you deploy. In a production build, `<Kotick />` renders nothing, and the bundler removes the registry and the panel. [Choose an adapter](https://kotick.smintfy.com/docs/concepts#choose-an-adapter) shows what each adapter keeps, and its size.

Check two things in your build:

- The bundler must replace `process.env.NODE_ENV` with `"production"`. Vite, Next.js (webpack and Turbopack), and React Router do this. With esbuild, add `--define:process.env.NODE_ENV='"production"'`.
- The fixtures loader must have a development check, as in the [Fixtures](https://kotick.smintfy.com/docs/fixtures) examples. Without the check, the build makes a fixtures chunk that the app never loads.

## Documentation

The main pages of the [docs](https://kotick.smintfy.com):

- [Concepts](https://kotick.smintfy.com/docs/concepts) explains state machines, the terms that the panel uses, and how to choose an adapter.
- [How kotick works](https://kotick.smintfy.com/docs/how-it-works) explains the registry, the adapters, and the overlay.
- [Reducer machines](https://kotick.smintfy.com/docs/reducer) and [XState machines](https://kotick.smintfy.com/docs/xstate) are the guides for the two adapters.
- [Fixtures](https://kotick.smintfy.com/docs/fixtures) gives context to the states that you have not visited.
- [Next.js](https://kotick.smintfy.com/docs/nextjs) covers the App Router, server components, and the Pages Router.
- [API](https://kotick.smintfy.com/docs/api) lists the props of `<Kotick />` and the exports of each entry.
- [Troubleshooting](https://kotick.smintfy.com/docs/troubleshooting) lists each console message, with its cause and fix.
- [Limitations](https://kotick.smintfy.com/docs/limitations) lists what kotick cannot do in this version.

## License

MIT
