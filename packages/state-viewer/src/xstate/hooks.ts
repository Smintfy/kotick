// The @xstate/react hooks, built on the actor proxy. Same names and signatures, plus `debug`.

import { useActorRef as useXStateActorRef, useSelector } from '@xstate/react';
import * as React from 'react';
import {
  toObserver,
  type Actor,
  type ActorOptions,
  type AnyActorLogic,
  type AnyActorRef,
  type AnyStateMachine,
  type ConditionalRequired,
  type IsNotNever,
  type Observer,
  type RequiredActorOptionsKeys,
  type SnapshotFrom,
  type StateFrom,
} from 'xstate';
import { isMachineActor } from './actor';
import { nextInstanceId, resolveMachineId } from './identity';
import type { HookActorOptions, WithDebug } from './options';
import { findBinding, getBinding, isProxy, type Binding, type Registration } from './proxy';
import { createView, createViewMemory, type View, type ViewLifetime, type ViewMemory } from './view';

type ObserverOrListener<T> = Observer<T> | ((value: T) => void);

// Layout effects run before @xstate/react's passive ones; on the server neither runs.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

/** The connection made for `key`, which `disconnect` ends. */
interface Connection<T> {
  key: T;
  disconnect: () => void;
}

/** Holds a hook's connection between commits, as a ref does. */
interface ConnectionSlot<T> {
  current?: Connection<T>;
}

interface Listening {
  binding: Binding;
  view: View;
}

/**
 * What useProxiedActorRef keeps while the component is mounted, in one hook rather than one for each value.
 * Every row of a list runs these hooks, and each hook has a cost.
 */
interface HookState {
  instanceId: string;
  /**
   * The committed actor, binding and view, written in the commit phase: a render React throws away (a suspended
   * transition) can make a new actor, which never starts, and must not move the observers of the committed one.
   */
  committed: { actor?: AnyActorRef; binding?: Binding; view?: View };
  /**
   * Shared by the views of every observer the component passes, an inline one being new on each render, and kept per
   * actor, which stays the same while debug is turned off and on.
   */
  memory: ViewMemory;
  listening: ConnectionSlot<Listening>;
  registration: ConnectionSlot<Registration>;
}

function createHookState(): HookState {
  const committed: HookState['committed'] = {};

  return {
    instanceId: nextInstanceId(),
    committed,
    memory: createViewMemory(() => committed.actor),
    listening: {},
    registration: {},
  };
}

/** Connects `key` in place of the connection the slot holds, unless that one is for the same key. */
function ensureConnection<T extends object>(
  slot: ConnectionSlot<T>,
  key: T | undefined,
  connect: (key: T) => () => void,
): void {
  if (slot.current?.key === key) return;
  slot.current?.disconnect();
  slot.current = key === undefined ? undefined : { key, disconnect: connect(key) };
}

/**
 * Keeps `connect(key)` connected for as long as @xstate/react keeps the actor running: from the layout phase, where
 * the caller connects it with ensureConnection() before @xstate/react's passive effect starts the actor, to a passive
 * cleanup, where it stops it. Unmounting, StrictMode's simulated unmount and a hidden Activity run passive cleanups.
 * A Suspense boundary hiding the component runs only layout cleanups, and the actor keeps running, so the connection
 * stays.
 */
function useConnection<T extends object>(
  slot: ConnectionSlot<T>,
  key: T | undefined,
  connect: (key: T) => () => void,
): void {
  React.useEffect(() => {
    // Fast Refresh runs every cleanup and setup again, the passive ones after the layout ones.
    ensureConnection(slot, key, connect);

    return () => {
      // A newer key's connection, made in this commit's layout phase, stays.
      if (slot.current === undefined || slot.current.key !== key) return;
      slot.current.disconnect();
      slot.current = undefined;
    };
  }, [key]);
}

/** Follows the binding's previews in the view, until the returned cleanup. */
function listen(committed: HookState['committed'], { binding, view }: Listening): () => void {
  const stop = binding.onPreviewChange(view.showCurrent);

  // The preview that held back how the actor ended can end while the hook isn't listening (an Activity hid it), and a
  // replaced actor's owed ending isn't held by a preview of another key. XState repeats a finished or failed actor's
  // ending when @xstate/react restarts it, but tells a stopped one nothing.
  if (view.owes()) view.showCurrent();

  return () => {
    stop();

    // The hook no longer previews the actor (debug.disabled): the observer leaves the preview, as on a release. The
    // committed view's, which @xstate/react subscribes to the new actor when one replaced this one in the same render.
    if (committed.binding === undefined) (committed.view ?? view).detach(binding);
  };
}

const connectRegistration = (registration: Registration): (() => void) => registration.connect();

/**
 * Creates and starts the actor through @xstate/react, then hands out its proxy. Machines are registered while the
 * component is mounted; other actor logic, and actors with `debug.disabled`, come back as they are.
 *
 * `observer` sees what the proxy shows. It goes to @xstate/react, which subscribes it before starting the
 * actor, so an error on start reaches it and isn't also reported as unhandled. It's subscribed again when
 * `observerKey` changes.
 */
function useProxiedActorRef(
  logic: AnyActorLogic,
  options: (ActorOptions<AnyActorLogic> & WithDebug) | undefined,
  observer?: ObserverOrListener<unknown>,
  { observerKey, lifetime = 'ended' }: { observerKey?: unknown; lifetime?: ViewLifetime } = {},
): AnyActorRef {
  const { debug, ...actorOptions } = options ?? {};
  const [hook] = React.useState(createHookState);
  const { committed } = hook;

  const observed = React.useMemo(() => {
    if (!observer) return undefined;
    // The actor @xstate/react subscribed this observer to, once it has. It subscribes an observer again only when the
    // observer changes, or when its effects run again (StrictMode, an Activity reveal): a stable observer stays with
    // the actor a new config replaced, which then tells it nothing, and so do the new actor's previews. Each view has
    // its own, so a render React throws away, which passes a new observer, doesn't move the committed one.
    const subscription: { actor?: AnyActorRef; afterStop?: boolean } = {};

    const view = createView(toObserver(observer), () => committed.binding, lifetime, undefined, hook.memory, {
      subscribed: () => subscription.actor !== undefined,
      replaced: () => {
        const { actor } = subscription;

        return actor === undefined || actor === committed.actor ? undefined : { source: findBinding(actor) };
      },
      subscribedAfterStop: () => subscription.afterStop === true,
    });

    return { view, subscription };
    // observerKey isn't read, but decides when @xstate/react subscribes the observer again.
  }, [observer, observerKey]);

  const view = observed?.view;
  // Runs right before @xstate/react's effect that subscribes the observer, whenever that one runs, and reads the actor
  // that one's closure holds: the one committed last. XState ends an observer inside subscribe() when the actor has
  // stopped (ProcessingStatus.Stopped, which @xstate/react resets when it restarts one).
  React.useEffect(() => {
    if (!observed) return;
    const actor = committed.actor;
    observed.subscription.actor = actor;
    observed.subscription.afterStop = (actor as { _processingStatus?: number } | undefined)?._processingStatus === 2;
  }, [observed]);
  const actor = (useXStateActorRef as (...args: unknown[]) => AnyActorRef)(logic, actorOptions, view?.observer);
  // After @xstate/react's cleanup, which stops the actor and drops its observers without telling them: the
  // subscriptions made through the proxy end with them. A connect()ed child stops following previews once it stops.
  React.useEffect(() => () => findBinding(actor)?.dropObservers(), [actor]);
  const binding = debug?.disabled || !isMachineActor(actor) ? undefined : getBinding(actor);

  const registration = binding?.registration({
    // The actor's logic rather than this render's: @xstate/react keeps the actor while the config stays the same.
    machineId: resolveMachineId((actor as unknown as { logic: AnyStateMachine }).logic, debug?.id),
    instanceId: hook.instanceId,
    label: debug?.label,
  });

  const listening = React.useMemo(() => (binding && view ? { binding, view } : undefined), [binding, view]);
  const connectListening = (key: Listening): (() => void) => listen(committed, key);
  // One layout effect for four steps, which keep this order. A step does nothing while its own values stay the same.
  useIsomorphicLayoutEffect(() => {
    // Before the connections, which read them. A new observer follows the committed actor's previews from here on,
    // before @xstate/react subscribes it: it hears a deep link before the first paint.
    committed.actor = actor;
    committed.binding = binding;
    committed.view = view;
    // Before the registration, so a preview applied when the actor registers (a deep link) reaches the observer.
    ensureConnection(hook.listening, listening, connectListening);

    // The observer leaves the preview here, as in listen()'s cleanup, when the hook stopped previewing while it wasn't
    // listening (debug.disabled while an Activity hid it): layout effects run again on the reveal, before
    // @xstate/react restarts the actor. With a new actor too, so the memory moves to it in the commit, before the
    // replaced actor tells the observer anything more.
    if (!listening) view?.settle();
    // @xstate/react starts the actor in a passive effect, after this layout effect.
    // So the registry records the first rendered snapshot and every snapshot that start() goes through.
    ensureConnection(hook.registration, registration, connectRegistration);
  }, [actor, binding, view, listening, registration]);
  useConnection(hook.listening, listening, connectListening);
  useConnection(hook.registration, registration, connectRegistration);

  return binding ? binding.proxy : actor;
}

/** Wakes useSyncExternalStore; the snapshot itself is read through the proxy. */
function createStore() {
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of [...listeners]) listener();
  };

  return {
    observer: { next: emit, error: emit } satisfies Observer<unknown>,
    subscribe(listener: () => void) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useActorRef<TLogic extends AnyActorLogic>(
  machine: TLogic,
  ...[options, observerOrListener]: IsNotNever<RequiredActorOptionsKeys<TLogic>> extends true
    ? [
        options: HookActorOptions<TLogic>,
        observerOrListener?: Observer<SnapshotFrom<TLogic>> | ((value: SnapshotFrom<TLogic>) => void),
      ]
    : [
        options?: ActorOptions<TLogic> & WithDebug,
        observerOrListener?: Observer<SnapshotFrom<TLogic>> | ((value: SnapshotFrom<TLogic>) => void),
      ]
): Actor<TLogic> {
  return useProxiedActorRef(machine, options, observerOrListener as ObserverOrListener<unknown>) as Actor<TLogic>;
}

export function useActor<TLogic extends AnyActorLogic>(
  logic: TLogic,
  ...[options]: ConditionalRequired<[options?: HookActorOptions<TLogic>], IsNotNever<RequiredActorOptionsKeys<TLogic>>>
): [SnapshotFrom<TLogic>, Actor<TLogic>['send'], Actor<TLogic>] {
  if (!!logic && 'send' in logic && typeof logic.send === 'function') {
    throw new Error(
      `useActor() expects actor logic (e.g. a machine), but received an ActorRef. Use the useSelector(actorRef, ...) hook instead to read the ActorRef's snapshot.`,
    );
  }

  const [store] = React.useState(createStore);

  // Subscribed again when @xstate/react makes a new actor, which it does when the config changes (Fast Refresh).
  const actorRef = useProxiedActorRef(logic, options, store.observer, {
    observerKey: (logic as { config?: unknown }).config,
    lifetime: 'stopped',
  });

  // A proxy's getSnapshot doesn't use `this`. useSyncExternalStore calls it often, so it skips the proxy's get trap.
  const getSnapshot = React.useMemo(
    () => (isProxy(actorRef) ? actorRef.getSnapshot : () => actorRef.getSnapshot()),
    [actorRef],
  );

  const snapshot = React.useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
  // useSyncExternalStore subscribes, and checks the snapshot it rendered, in a passive effect, which runs after the
  // paint unless the commit was synchronous. A preview applied in this commit's layout phase (a deep link, as the actor
  // registers) re-renders from here instead, synchronously, so the first paint shows it.
  const [, rerender] = React.useReducer((count: number) => count + 1, 0);
  useIsomorphicLayoutEffect(() => {
    if (!Object.is(getSnapshot(), snapshot)) rerender();
  });

  if (typeof snapshot === 'object' && snapshot !== null && 'status' in snapshot && snapshot.status === 'error') {
    throw (snapshot as { error: unknown }).error;
  }

  return [snapshot, actorRef.send, actorRef] as [SnapshotFrom<TLogic>, Actor<TLogic>['send'], Actor<TLogic>];
}

/** @alias useActor */
export function useMachine<TMachine extends AnyStateMachine>(
  machine: TMachine,
  ...[options]: ConditionalRequired<
    [options?: HookActorOptions<TMachine>],
    IsNotNever<RequiredActorOptionsKeys<TMachine>>
  >
): [StateFrom<TMachine>, Actor<TMachine>['send'], Actor<TMachine>] {
  return (useActor as (logic: AnyActorLogic, options?: unknown) => never)(machine, options);
}

/** @xstate/react's createActorContext, with a Provider that creates a proxied actor. */
export function createActorContext<TLogic extends AnyActorLogic>(
  actorLogic: TLogic,
  actorOptions?: ActorOptions<TLogic> & WithDebug,
): {
  useSelector: <T>(selector: (snapshot: SnapshotFrom<TLogic>) => T, compare?: (a: T, b: T) => boolean) => T;
  useActorRef: () => Actor<TLogic>;
  Provider: (props: {
    children: React.ReactNode;
    options?: ActorOptions<TLogic> & WithDebug;
    /** @deprecated Use `logic` instead. */
    machine?: never;
    logic?: TLogic;
  }) => React.ReactElement<any, any>;
} {
  const ReactContext = React.createContext<Actor<TLogic> | null>(null);
  const OriginalProvider = ReactContext.Provider;

  function Provider({
    children,
    logic: providedLogic = actorLogic,
    machine,
    options: providedOptions,
  }: {
    children: React.ReactNode;
    options?: ActorOptions<TLogic> & WithDebug;
    machine?: never;
    logic?: TLogic;
  }) {
    if (machine) {
      throw new Error(`The "machine" prop has been deprecated. Please use "logic" instead.`);
    }

    const actor = useProxiedActorRef(providedLogic, { ...actorOptions, ...providedOptions }) as Actor<TLogic>;

    return React.createElement(OriginalProvider, { value: actor, children });
  }

  Provider.displayName = `ActorProvider`;

  function useContext() {
    const actor = React.useContext(ReactContext);

    if (!actor) {
      throw new Error(
        `You used a hook from "${Provider.displayName}" but it's not inside a <${Provider.displayName}> component.`,
      );
    }

    return actor;
  }

  function useContextSelector<T>(selector: (snapshot: SnapshotFrom<TLogic>) => T, compare?: (a: T, b: T) => boolean) {
    const actor = useContext();

    return useSelector(actor, selector as (snapshot: unknown) => T, compare);
  }

  return {
    Provider,
    useActorRef: useContext,
    useSelector: useContextSelector,
  };
}
