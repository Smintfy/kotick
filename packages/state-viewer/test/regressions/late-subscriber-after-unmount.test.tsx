// A subscription made through a hook actor's proxy after its component unmounted (an async handler that awaits, then
// calls waitFor, actorRef.subscribe or actorRef.select(...).subscribe on the actor it kept) joins the stopped actor's
// observers, as with @xstate/react, and nothing page-wide holds on to it. The hook unregistered the actor, so the
// registry refuses previews of its key, and the proxy listens to the registry only while one of its registrations is
// connected or the registry still keeps a preview for it (spec §10.2, "Lifecycle" and "Observers and the actor's
// ending"). The subscription adds no registry override listener and hears no preview, and the actor can be
// garbage-collected with it pending, as @xstate/react's can. The same holds for a subscription made while an <Activity>
// hides the component, when the hidden Activity is then removed: React doesn't run the hidden tree's passive cleanups
// again, so the hook never gets to end that subscription. When the Activity is revealed instead, the hook registers the
// actor again, and the subscription follows the real actor and its previews (R11), as it follows the real actor with
// @xstate/react. Under StrictMode the reveal's simulated unmount stops the actor and ends it, for both.

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import v8 from 'node:v8';
import vm from 'node:vm';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createMachine, waitFor, type AnyActorRef } from 'xstate';
import * as stateViewer from '../../src/xstate';
import {
  ACTOR_SELECT,
  describeWithActivity,
  flush,
  keyOf,
  onlyHandle,
  registry,
  resetRegistry,
} from '../xstate/helpers';

v8.setFlagsFromString('--expose-gc');
const collectGarbage = vm.runInNewContext('gc') as () => void;

const formMachine = createMachine({
  id: 'form',
  initial: 'editing',
  states: {
    editing: { on: { SUBMIT: 'submitting' } },
    submitting: { on: { SAVED: 'saved' } },
    saved: { type: 'final' },
  },
});

type UseActorRef = (logic: typeof formMachine) => AnyActorRef;
const svUseActorRef = stateViewer.useActorRef as unknown as UseActorRef;
const IMPLEMENTATIONS: [name: string, useActorRef: UseActorRef, control: boolean][] = [
  ['@xstate/react (control)', xstateReact.useActorRef as unknown as UseActorRef, true],
  ['state-viewer/xstate', svUseActorRef, false],
];

/** Subscribes to the actor and records, in `heard`, the state values the subscription is given. */
type Subscribe = (actorRef: AnyActorRef, heard: string[]) => void;

const SUBSCRIPTIONS: [name: string, subscribe: Subscribe][] = [
  [
    'waitFor',
    (actorRef, heard) => {
      void waitFor(actorRef, (snapshot) => {
        heard.push(String(snapshot.value));
        return snapshot.status === 'done';
      }).catch(() => {});
    },
  ],
  [
    'subscribe(listener)',
    (actorRef, heard) => {
      actorRef.subscribe((snapshot: { value: unknown }) => heard.push(String(snapshot.value)));
    },
  ],
  [
    'select().subscribe',
    (actorRef, heard) => {
      actorRef.select((snapshot: { value: unknown }) => String(snapshot.value)).subscribe((value) => heard.push(value));
    },
  ],
];

/** The subscriptions to try with an implementation. XState's own actors have select() from XState 5.29. */
function subscriptionsFor(control: boolean): [name: string, subscribe: Subscribe][] {
  return !control || ACTOR_SELECT ? SUBSCRIPTIONS : SUBSCRIPTIONS.filter(([name]) => !name.startsWith('select'));
}

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

const Activity = (
  React as unknown as { Activity: React.ComponentType<{ mode: 'visible' | 'hidden'; children: React.ReactNode }> }
).Activity;

/**
 * Mounts a form, unmounts it (the user navigates away), then subscribes to the actor it handed out, as a handler's
 * continuation would. `mounted` runs while the form is mounted. Returns a weak reference to the real actor's system.
 */
async function navigateAwayThenSubscribe(
  useActorRef: UseActorRef,
  subscribe: Subscribe,
  heard: string[] = [],
  mounted?: () => void,
): Promise<WeakRef<object>> {
  let actorRef: AnyActorRef | undefined;
  function Form() {
    actorRef = useActorRef(formMachine);
    return null;
  }
  const { unmount } = render(<Form />);
  await flush();
  mounted?.();
  const held = actorRef!;
  actorRef = undefined;
  unmount();
  await flush();
  subscribe(held, heard);
  // What a subscription hears from here on; waitFor checks the current snapshot as it subscribes.
  heard.length = 0;
  const system = new WeakRef((held as unknown as { system: object }).system);
  await flush();
  return system;
}

/**
 * Mounts a form in an Activity, hides it, subscribes to its actor while it's hidden (from a component outside it, or a
 * handler), then removes the hidden Activity altogether. Returns a weak reference to the real actor's system.
 */
async function subscribeWhileHiddenThenRemove(useActorRef: UseActorRef, subscribe: Subscribe): Promise<WeakRef<object>> {
  let actorRef: AnyActorRef | undefined;
  function Form() {
    actorRef = useActorRef(formMachine);
    return null;
  }
  function App({ mode, shown }: { mode: 'visible' | 'hidden'; shown: boolean }) {
    return shown ? (
      <Activity mode={mode}>
        <Form />
      </Activity>
    ) : null;
  }
  const view = render(<App mode="visible" shown />);
  await flush();
  view.rerender(<App mode="hidden" shown />);
  await flush();
  const held = actorRef!;
  actorRef = undefined;
  subscribe(held, []);
  const system = new WeakRef((held as unknown as { system: object }).system);
  view.rerender(<App mode="hidden" shown={false} />);
  await flush();
  view.unmount();
  await flush();
  return system;
}

/**
 * Mounts a form in an Activity, hides it, subscribes to its actor while it's hidden, then reveals it. Returns what the
 * subscription hears from then on, and the form's actor.
 */
async function subscribeWhileHiddenThenReveal(useActorRef: UseActorRef, subscribe: Subscribe, reactStrictMode: boolean) {
  const heard: string[] = [];
  let actorRef: AnyActorRef | undefined;
  function Form() {
    actorRef = useActorRef(formMachine);
    return null;
  }
  function App({ mode }: { mode: 'visible' | 'hidden' }) {
    return (
      <Activity mode={mode}>
        <Form />
      </Activity>
    );
  }
  const view = render(<App mode="visible" />, { reactStrictMode });
  await flush();
  view.rerender(<App mode="hidden" />);
  await flush();
  subscribe(actorRef!, heard);
  view.rerender(<App mode="visible" />);
  await flush();
  heard.length = 0;
  return { heard, actorRef: () => actorRef! };
}

beforeEach(() => {
  resetRegistry();
  // Previews of states without a recording or fixture warn about falling back to live context, and previews of an
  // unregistered key warn that nothing is registered under it.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

describe('a subscription made through a hook proxy after the component unmounted', () => {
  test.each(SUBSCRIPTIONS)('%s: adds no registry override listener', async (_name, subscribe) => {
    const active = countOverrideListeners();
    await navigateAwayThenSubscribe(svUseActorRef, subscribe);

    expect(registry().getSnapshot().machines).toEqual([]);
    expect(active()).toBe(0);
  });

  test.each(SUBSCRIPTIONS)('%s: hears no preview: the registry refuses previews of the key', async (_name, subscribe) => {
    const heard: string[] = [];
    let key = '';
    await navigateAwayThenSubscribe(svUseActorRef, subscribe, heard, () => {
      key = keyOf(onlyHandle('form'));
    });

    act(() => registry().preview(key, { leaves: ['submitting'] }));
    await flush();
    expect(registry().getOverride(key)).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('no machine is registered under that key'));
    expect(heard).toEqual([]);
  });

  describe.each(IMPLEMENTATIONS)('with %s', (_name, useActorRef, control) => {
    const subscriptions = subscriptionsFor(control);
    test.each(subscriptions)('%s: the actor can be garbage-collected with it pending', async (_kind, subscribe) => {
      const refs: WeakRef<object>[] = [];
      for (let i = 0; i < 3; i++) refs.push(await navigateAwayThenSubscribe(useActorRef, subscribe));

      expect(await collected(refs)).toEqual([true, true, true]);
    });
  });
});

describeWithActivity('a subscription made while an <Activity> hides the component, which is then removed', () => {
  test.each(SUBSCRIPTIONS)('%s: adds no registry override listener', async (_name, subscribe) => {
    const active = countOverrideListeners();
    await subscribeWhileHiddenThenRemove(svUseActorRef, subscribe);

    expect(registry().getSnapshot().machines).toEqual([]);
    expect(active()).toBe(0);
  });

  describe.each(IMPLEMENTATIONS)('with %s', (_name, useActorRef, control) => {
    const subscriptions = subscriptionsFor(control);
    test.each(subscriptions)('%s: the actor can be garbage-collected with it pending', async (_kind, subscribe) => {
      const refs: WeakRef<object>[] = [];
      for (let i = 0; i < 3; i++) refs.push(await subscribeWhileHiddenThenRemove(useActorRef, subscribe));

      expect(await collected(refs)).toEqual([true, true, true]);
    });
  });
});

describeWithActivity('a subscription made while an <Activity> hides the component, which is then revealed', () => {
  const STRICT: [reactStrictMode: boolean, expected: string[]][] = [
    [false, ['submitting']],
    [true, []],
  ];

  describe.each(IMPLEMENTATIONS)('with %s', (_name, useActorRef, control) => {
    describe.each(subscriptionsFor(control))('%s', (_kind, subscribe) => {
      test.each(STRICT)('StrictMode %s: a real transition after the reveal', async (strict, expected) => {
        const { heard, actorRef } = await subscribeWhileHiddenThenReveal(useActorRef, subscribe, strict);

        act(() => actorRef().send({ type: 'SUBMIT' }));
        await flush();
        expect(heard).toEqual(expected);
      });
    });
  });

  describe.each(SUBSCRIPTIONS)('state-viewer/xstate, %s', (_kind, subscribe) => {
    test.each(STRICT)('StrictMode %s: a preview after the reveal', async (strict, expected) => {
      const { heard } = await subscribeWhileHiddenThenReveal(svUseActorRef, subscribe, strict);

      act(() => registry().preview(keyOf(onlyHandle('form')), { leaves: ['submitting'] }));
      await flush();
      expect(heard).toEqual(expected);
    });
  });
});
