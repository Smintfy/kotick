// When @xstate/react stops a hook's actor (unmount, StrictMode's simulated unmount, a hidden Activity, Fast Refresh),
// it drops every XState observer of the actor and its descendants without telling them, then puts the last active
// snapshot back. Subscriptions made through the proxy (waitFor, select().subscribe, actorRef.subscribe outside React)
// end along with their XState observers (spec §10.2, "Observers and the actor's ending"): they hear neither the real
// actor nor its previews any more, as they would hear nothing from @xstate/react's actor, and they don't keep the
// unmounted actor alive through the page-wide registry. Under StrictMode an effect that awaits waitFor runs twice, and
// only the second run's subscription follows the actor, for a real transition and for a preview alike.

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import v8 from 'node:v8';
import vm from 'node:vm';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createMachine, waitFor, type AnyActorRef } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { describeWithActivity, flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

v8.setFlagsFromString('--expose-gc');
const collectGarbage = vm.runInNewContext('gc') as () => void;

const fieldMachine = createMachine({
  id: 'field',
  initial: 'pristine',
  states: { pristine: { on: { EDIT: 'dirty' } }, dirty: {} },
});

const formMachine = createMachine({
  id: 'form',
  initial: 'loading',
  invoke: { id: 'field', src: fieldMachine },
  states: {
    loading: { on: { LOADED: 'ready' } },
    ready: { on: { SUBMIT: 'submitting' } },
    submitting: { on: { SAVED: 'saved' } },
    saved: { type: 'final' },
  },
});

type UseActorRef = (logic: typeof formMachine) => AnyActorRef;
const svUseActorRef = stateViewer.useActorRef as unknown as UseActorRef;
const IMPLEMENTATIONS: [name: string, useActorRef: UseActorRef][] = [
  ['@xstate/react (control)', xstateReact.useActorRef as unknown as UseActorRef],
  ['state-viewer/xstate', svUseActorRef],
];

/** Which of the targets are gone after a few full collections. Nothing derefs before collecting. */
async function collected(refs: WeakRef<object>[]): Promise<boolean[]> {
  for (let turn = 0; turn < 3; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    collectGarbage();
  }
  return refs.map((ref) => ref.deref() === undefined);
}

/** Counts the registry override listeners added from now on and not removed yet. */
function countOverrideListeners(): () => number {
  const target = registry();
  const original = target.onOverride.bind(target);
  let active = 0;
  vi.spyOn(target, 'onOverride').mockImplementation((key, listener) => {
    active++;
    const off = original(key, listener);
    let on = true;
    return () => {
      if (on) {
        on = false;
        active--;
      }
      off();
    };
  });
  return () => active;
}

/**
 * Mounts a form, subscribes to it outside React's lifecycle with `subscribe`, unmounts it before the subscription
 * settles (the user navigates away), and returns a weak reference to the real actor's system.
 */
async function subscribeThenNavigateAway(
  useActorRef: UseActorRef,
  subscribe: (actorRef: AnyActorRef) => void,
): Promise<WeakRef<object>> {
  let actorRef: AnyActorRef | undefined;
  function Form() {
    actorRef = useActorRef(formMachine);
    return null;
  }
  const { unmount } = render(<Form />);
  await flush();
  subscribe(actorRef!);
  const system = new WeakRef((actorRef as unknown as { system: object }).system);
  actorRef = undefined;
  unmount();
  await flush();
  return system;
}

const awaitSaved = (actorRef: AnyActorRef): void => {
  void waitFor(actorRef, (snapshot) => snapshot.status === 'done').catch(() => {});
};

beforeEach(() => {
  resetRegistry();
  // Previews of states without a recording or fixture warn about falling back to live context.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

describe('a hook actor unmounted while a subscription to its proxy is open', () => {
  test('leaves no registry override listener behind for a pending waitFor', async () => {
    const active = countOverrideListeners();
    await subscribeThenNavigateAway(svUseActorRef, awaitSaved);

    expect(registry().getSnapshot().machines).toEqual([]);
    expect(active()).toBe(0);
  });

  test('leaves none behind for a subscription to a connect()ed child either', async () => {
    const active = countOverrideListeners();
    await subscribeThenNavigateAway(svUseActorRef, (actorRef) => {
      const field = stateViewer.connect(actorRef.getSnapshot().children.field as AnyActorRef);
      field.subscribe(() => {});
    });

    expect(registry().getSnapshot().machines).toEqual([]);
    expect(active()).toBe(0);
  });

  describe.each(IMPLEMENTATIONS)('with %s', (_name, useActorRef) => {
    test('can be garbage-collected without a pending waitFor', async () => {
      const refs: WeakRef<object>[] = [];
      for (let i = 0; i < 3; i++) refs.push(await subscribeThenNavigateAway(useActorRef, () => {}));

      expect(await collected(refs)).toEqual([true, true, true]);
    });

    test('can be garbage-collected with a pending waitFor', async () => {
      const refs: WeakRef<object>[] = [];
      for (let i = 0; i < 3; i++) refs.push(await subscribeThenNavigateAway(useActorRef, awaitSaved));

      expect(await collected(refs)).toEqual([true, true, true]);
    });

    test('can be garbage-collected with a subscription, never unsubscribed, that has complete', async () => {
      const refs: WeakRef<object>[] = [];
      const subscribe = (actorRef: AnyActorRef): void => {
        actorRef.subscribe({ next: () => {}, complete: () => {} });
      };
      for (let i = 0; i < 3; i++) refs.push(await subscribeThenNavigateAway(useActorRef, subscribe));

      expect(await collected(refs)).toEqual([true, true, true]);
    });
  });
});

describe('under StrictMode, an effect without cleanup that follows the hook actor', () => {
  /** What the effect's two runs heard. StrictMode runs it twice, as React does in development. */
  function mount(useActorRef: UseActorRef, follow: 'waitFor' | 'subscribe') {
    const heard: string[] = [];
    let current: AnyActorRef | undefined;
    let runs = 0;
    function Form() {
      const actorRef = useActorRef(formMachine);
      current = actorRef;
      React.useEffect(() => {
        const run = ++runs;
        if (follow === 'waitFor') {
          void waitFor(actorRef, (snapshot) => snapshot.matches('ready')).then(
            (snapshot) => heard.push(`${run}:${String(snapshot.value)}`),
            () => {},
          );
        } else {
          actorRef.subscribe((snapshot: { value: unknown }) => heard.push(`${run}:${String(snapshot.value)}`));
        }
      }, [actorRef]);
      return null;
    }
    render(<Form />);
    return { heard, actorRef: () => current! };
  }

  describe.each(IMPLEMENTATIONS)('with %s', (_name, useActorRef) => {
    test.each(['waitFor', 'subscribe'] as const)('%s: a real transition reaches the second run only', async (follow) => {
      const { heard, actorRef } = mount(useActorRef, follow);
      await flush();

      act(() => actorRef().send({ type: 'LOADED' }));
      await flush();
      expect(heard).toEqual(['2:ready']);
    });
  });

  test.each(['waitFor', 'subscribe'] as const)('%s: a preview reaches the second run only', async (follow) => {
    const { heard } = mount(svUseActorRef, follow);
    await flush();

    act(() => registry().preview(keyOf(onlyHandle('form')), { leaves: ['ready'] }));
    await flush();
    expect(heard).toEqual(['2:ready']);
  });
});

describeWithActivity('an Activity hiding and revealing the component', () => {
  const Activity = (
    React as unknown as {
      Activity: React.ComponentType<{ mode: 'visible' | 'hidden'; children: React.ReactNode }>;
    }
  ).Activity;

  /** Subscribes to the form outside React, then hides and reveals it. */
  async function hideAndReveal(useActorRef: UseActorRef): Promise<{ heard: string[]; actorRef: AnyActorRef }> {
    const heard: string[] = [];
    let current: AnyActorRef | undefined;
    function Form() {
      current = useActorRef(formMachine);
      return null;
    }
    function App({ mode }: { mode: 'visible' | 'hidden' }) {
      return (
        <Activity mode={mode}>
          <Form />
        </Activity>
      );
    }
    const view = render(<App mode="visible" />);
    await flush();
    current!.subscribe((snapshot: { value: unknown }) => heard.push(String(snapshot.value)));
    view.rerender(<App mode="hidden" />);
    await flush();
    view.rerender(<App mode="visible" />);
    await flush();
    heard.length = 0;
    return { heard, actorRef: current! };
  }

  test.each(IMPLEMENTATIONS)('%s: ends a subscription made before hiding', async (_name, useActorRef) => {
    const { heard, actorRef } = await hideAndReveal(useActorRef);

    act(() => actorRef.send({ type: 'LOADED' }));
    await flush();
    expect(heard).toEqual([]);
  });

  test('state-viewer/xstate: the ended subscription hears no preview either', async () => {
    const { heard } = await hideAndReveal(svUseActorRef);

    act(() => registry().preview(keyOf(onlyHandle('form')), { leaves: ['ready'] }));
    await flush();
    expect(heard).toEqual([]);
  });
});
