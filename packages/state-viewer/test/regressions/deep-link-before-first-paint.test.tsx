// A deep link previews a machine the moment its instance registers, which the hooks do in a layout effect,
// and the first paint already shows the previewed state:
// - the observer given to useActorRef hears the preview there, following the previews of the actor it's passed with
//   from the render that passes it, before @xstate/react subscribes it in a passive effect; a state update it makes
//   in the layout phase is synchronous;
// - the hooks' own store (useMachine, useActor) hears it there too, but useSyncExternalStore subscribes to it, and
//   checks the snapshot it rendered, only in a passive effect, which runs after the paint unless the commit was
//   synchronous; the hook re-renders from a layout effect instead when the snapshot changed since the render.
//
// The DOM is read at the end of the task that commits the mount (a microtask queued from a layout effect of a
// component committed after the hook's), where the browser paints, for a default-priority mount (root.render(), as
// every app bootstraps), a transition (a router navigation, a Suspense reveal) and flushSync.

import * as React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createMachine } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { keyOf, registry, resetRegistry } from '../xstate/helpers';

const toggleMachine = createMachine({
  id: 'toggle',
  initial: 'off',
  states: { off: { on: { TOGGLE: 'on' } }, on: { on: { TOGGLE: 'off' } } },
});

const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

beforeEach(() => {
  resetRegistry();
  // Previews of states without a recording or fixture warn about falling back to live context.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

/** Previews 'on' on every instance the moment it registers, the way a deep link does. */
function previewOnRegister(): void {
  const target = registry();
  const register = target.register;
  vi.spyOn(target, 'register').mockImplementation((handle) => {
    const unregister = register(handle);
    target.preview(keyOf(handle), { leaves: ['on'] });
    return unregister;
  });
}

type Mount = 'root.render()' | 'a transition' | 'flushSync';

/** What the first paint shows: the DOM at the end of the task that commits the mount. */
async function firstPaint(Component: () => React.ReactElement, mount: Mount): Promise<string | null> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const previous = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    let painted: string | null = null;
    await new Promise<void>((resolve) => {
      function EndOfCommit() {
        React.useLayoutEffect(() => {
          queueMicrotask(() => {
            painted = container.textContent;
            resolve();
          });
        }, []);
        return null;
      }
      const app = (
        <React.StrictMode>
          <Component />
          <EndOfCommit />
        </React.StrictMode>
      );
      if (mount === 'a transition') React.startTransition(() => root.render(app));
      else if (mount === 'flushSync') flushSync(() => root.render(app));
      else root.render(app);
    });
    return painted;
  } finally {
    root.unmount();
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previous;
    container.remove();
  }
}

describe.each<Mount>(['root.render()', 'a transition', 'flushSync'])('mounted with %s', (mount) => {
  test('useMachine shows a deep link in the first paint', async () => {
    previewOnRegister();
    function Toggle() {
      const [snapshot] = stateViewer.useMachine(toggleMachine);
      return <span>{String(snapshot.value)}</span>;
    }

    expect(await firstPaint(Toggle, mount)).toBe('on');
  });

  test('useActor shows a deep link in the first paint', async () => {
    previewOnRegister();
    function Toggle() {
      const [snapshot] = stateViewer.useActor(toggleMachine);
      return <span>{String(snapshot.value)}</span>;
    }

    expect(await firstPaint(Toggle, mount)).toBe('on');
  });

  test('an observer given to useActorRef hears a deep link in time for the first paint', async () => {
    previewOnRegister();
    function Toggle() {
      const [value, setValue] = React.useState('unknown');
      stateViewer.useActorRef(toggleMachine, undefined, (snapshot) => setValue(String(snapshot.value)));
      return <span>{value}</span>;
    }

    expect(await firstPaint(Toggle, mount)).toBe('on');
  });
});
