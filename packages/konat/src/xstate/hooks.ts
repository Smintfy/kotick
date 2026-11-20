import { useActorRef as useXStateActorRef, useSelector as useXStateSelector } from '@xstate/react';
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';
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
  type Snapshot,
  type SnapshotFrom,
  type StateFrom,
} from 'xstate';
import { isMachineActor } from './actor';
import { nextInstanceId, resolveMachineId } from './identity';
import type { HookActorOptions, WithDebug } from './options';
import { findBinding, getBinding, isProxy, type Binding, type Registration } from './proxy';
import { createView, createViewMemory, type View, type ViewLifetime, type ViewMemory } from './view';

type ObserverOrListener<T> = Observer<T> | ((value: T) => void);

// Layout effects run before the passive effects of @xstate/react. On the server, neither runs.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

interface Connection<T> {
  key: T;
  disconnect: () => void;
}

interface ConnectionSlot<T> {
  current?: Connection<T>;
}

interface Listening {
  binding: Binding;
  view: View;
}

/**
 * The actor @xstate/react subscribed an observer to, once it has. It subscribes an observer again only when the
 * observer changes, or when its effects run again (StrictMode, an Activity reveal): a stable observer stays with
 * the actor a new config replaced, which then tells it nothing, and so do the new actor's previews.
 */
interface ObserverSubscription {
  actor?: AnyActorRef;
  /** Whether the actor had stopped by then: XState ends the observer inside subscribe() and tells it nothing more. */
  afterStop?: boolean;
}

/** XState keeps an actor's ProcessingStatus in `_processingStatus`, which its types don't declare. Stopped is 2. */
function isStoppedByXState(actor: AnyActorRef | undefined): boolean {
  return actor !== undefined && '_processingStatus' in actor && actor._processingStatus === 2;
}

/**
 * One hook keeps all of this, not one hook for each value.
 * Every row of a list runs these hooks, and each hook has a cost.
 */
interface HookState {
  instanceId: string;
  /**
   * The hook writes these in the commit phase, not during a render.
   * React can throw away a render (a suspended transition), which can make a new actor that never starts.
   * That actor must not move the observers of the committed one.
   */
  committed: { actor?: AnyActorRef; binding?: Binding; view?: View };
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
  useEffect(() => {
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

function listen(committed: HookState['committed'], { binding, view }: Listening): () => void {
  const stop = binding.onPreviewChange(view.showCurrent);

  // XState repeats a finished or failed actor's ending when @xstate/react restarts it, but tells a stopped one nothing.
  if (view.owes()) view.showCurrent();

  return () => {
    stop();

    // The hook no longer previews the actor (debug.disabled).
    // When a new actor replaced this one in the same render, @xstate/react subscribes the committed view to it.
    if (committed.binding === undefined) (committed.view ?? view).detach(binding);
  };
}

const connectRegistration = (registration: Registration): (() => void) => registration.connect();

/**
 * `observer` sees what the proxy shows.
 * The hook gives it to @xstate/react, which subscribes it before it starts the actor.
 * So an error on start gets to `observer`, and XState does not also report the error as unhandled.
 */
function useProxiedActorRef(
  logic: AnyActorLogic,
  options: (ActorOptions<AnyActorLogic> & WithDebug) | undefined,
  observer?: ObserverOrListener<unknown>,
  { observerKey, lifetime = 'ended' }: { observerKey?: unknown; lifetime?: ViewLifetime } = {},
): AnyActorRef {
  const { debug, ...actorOptions } = options ?? {};
  const [hook] = useState(createHookState);
  const { committed } = hook;

  const observed = useMemo(() => {
    if (!observer) return undefined;
    // Each view has its own subscription, so a render that React throws away can't move the committed one.
    const subscription: ObserverSubscription = {};

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
  // that one's closure holds: the one committed last. @xstate/react resets the status when it restarts a stopped actor.
  useEffect(() => {
    if (!observed) return;
    const actor = committed.actor;
    observed.subscription.actor = actor;
    observed.subscription.afterStop = isStoppedByXState(actor);
  }, [observed]);
  // An actor ref rather than @xstate/react's Actor, whose private _error keeps it from narrowing to a MachineActor.
  const actor: AnyActorRef = useXStateActorRef(logic, actorOptions, view?.observer);
  // This cleanup runs after the cleanup of @xstate/react, which stops the actor and drops its observers.
  // @xstate/react does not tell the observers, so the subscriptions made through the proxy also end here.
  useEffect(() => () => findBinding(actor)?.dropObservers(), [actor]);
  let binding: Binding | undefined;
  let registration: Registration | undefined;

  if (!debug?.disabled && isMachineActor(actor)) {
    binding = getBinding(actor);
    registration = binding.registration({
      // The actor's logic rather than this render's: @xstate/react keeps the actor while the config stays the same.
      machineId: resolveMachineId(actor.logic, debug?.id),
      instanceId: hook.instanceId,
      label: debug?.label,
    });
  }

  const listening = useMemo(() => (binding && view ? { binding, view } : undefined), [binding, view]);
  const connectListening = (key: Listening): (() => void) => listen(committed, key);
  // One layout effect for four steps, which keep this order. A step does nothing while its own values stay the same.
  useIsomorphicLayoutEffect(() => {
    // Before the connections, which read them.
    // A new observer follows the committed actor's previews from here on, before @xstate/react subscribes it.
    committed.actor = actor;
    committed.binding = binding;
    committed.view = view;
    // Before the registration, so the observer hears what the registration does to the preview.
    // Fast Refresh registers a new actor in place of the old one, and the registry releases a preview it can't show.
    ensureConnection(hook.listening, listening, connectListening);

    // An Activity reveal runs this layout effect again before @xstate/react restarts the actor.
    // With a new actor, settle() moves the memory to it before the replaced actor tells the observer more.
    if (!listening) view?.settle();
    // @xstate/react starts the actor in a passive effect, after this layout effect.
    // So the registry records the first rendered snapshot and every snapshot that start() goes through.
    ensureConnection(hook.registration, registration, connectRegistration);
  }, [actor, binding, view, listening, registration]);
  useConnection(hook.listening, listening, connectListening);
  useConnection(hook.registration, registration, connectRegistration);

  return binding ? binding.proxy : actor;
}

function createStore() {
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of Array.from(listeners)) listener();
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

/**
 * In a passive effect, useSyncExternalStore subscribes and checks the snapshot that it rendered.
 * A passive effect runs after the paint, unless the commit was synchronous.
 * A hidden Activity unregisters the hooks in it, and the registry then ends their previews.
 * The Activity can show a component again without a new render, so the last render can still show that preview.
 * This layout effect re-renders it synchronously, so the first paint shows the real snapshot.
 */
function useSnapshotCheck<T>(read: () => T, rendered: T): void {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  useIsomorphicLayoutEffect(() => {
    if (!Object.is(read(), rendered)) rerender();
  });
}

export function useSelector<TActor extends Pick<AnyActorRef, 'subscribe' | 'getSnapshot'> | undefined, T>(
  actor: TActor,
  selector: (snapshot: TActor extends { getSnapshot(): infer TSnapshot } ? TSnapshot : undefined) => T,
  compare?: (a: T, b: T) => boolean,
): T {
  const selection = useXStateSelector(actor, selector, compare);
  useSnapshotCheck(() => actor?.getSnapshot(), actor?.getSnapshot());

  return selection;
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
  // SAFETY: The actor @xstate/react makes from `machine` has the logic's types, and so does the proxy that stands in
  // for it. The observer takes that actor's snapshots, which the hook hands it as it gets them.
  return useProxiedActorRef(machine, options, observerOrListener as ObserverOrListener<unknown>) as Actor<TLogic>;
}

/** The check of @xstate/react for an actor passed in place of its logic. An actor has `send`, and logic doesn't. */
function isActorRef(logic: AnyActorLogic): logic is AnyActorLogic & Pick<AnyActorRef, 'send'> {
  return !!logic && 'send' in logic && typeof logic.send === 'function';
}

export function useActor<TLogic extends AnyActorLogic>(
  logic: TLogic,
  ...[options]: ConditionalRequired<[options?: HookActorOptions<TLogic>], IsNotNever<RequiredActorOptionsKeys<TLogic>>>
): [SnapshotFrom<TLogic>, Actor<TLogic>['send'], Actor<TLogic>] {
  if (isActorRef(logic)) {
    throw new Error(
      `useActor() expects actor logic (e.g. a machine), but received an ActorRef. Use the useSelector(actorRef, ...) hook instead to read the ActorRef's snapshot.`,
    );
  }

  const [store] = useState(createStore);

  // Subscribed again when @xstate/react makes a new actor, which it does when the config changes (Fast Refresh).
  const actorRef = useProxiedActorRef(logic, options, store.observer, {
    observerKey: logic.config,
    lifetime: 'stopped',
  });

  // A proxy's getSnapshot doesn't use `this`. useSyncExternalStore calls it often, so it skips the proxy's get trap.
  const getSnapshot = useMemo(
    (): (() => Snapshot<unknown>) => (isProxy(actorRef) ? actorRef.getSnapshot : () => actorRef.getSnapshot()),
    [actorRef],
  );

  const snapshot = useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
  useSnapshotCheck(getSnapshot, snapshot);

  if (snapshot.status === 'error') throw snapshot.error;

  // SAFETY: The proxy stands in for the actor @xstate/react made from `logic`, so it and its snapshots have the logic's
  // types.
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
  // SAFETY: useMachine is useActor with a machine's types, which has StateFrom for SnapshotFrom. The conditional tuple
  // of the options can't be spread into useActor while TMachine is unresolved.
  return (
    useActor as (
      logic: TMachine,
      options?: HookActorOptions<TMachine>,
    ) => [StateFrom<TMachine>, Actor<TMachine>['send'], Actor<TMachine>]
  )(machine, options);
}

/** @xstate/react's createActorContext, with a Provider that creates a proxied actor. */
export function createActorContext<TLogic extends AnyActorLogic>(
  actorLogic: TLogic,
  actorOptions?: ActorOptions<TLogic> & WithDebug,
): {
  useSelector: <T>(selector: (snapshot: SnapshotFrom<TLogic>) => T, compare?: (a: T, b: T) => boolean) => T;
  useActorRef: () => Actor<TLogic>;
  Provider: (props: {
    children: ReactNode;
    options?: ActorOptions<TLogic> & WithDebug;
    /** @deprecated Use `logic` instead. */
    machine?: never;
    logic?: TLogic;
  }) => ReactElement<any, any>;
} {
  const ReactContext = createContext<Actor<TLogic> | null>(null);
  const OriginalProvider = ReactContext.Provider;

  function Provider({
    children,
    logic: providedLogic = actorLogic,
    machine,
    options: providedOptions,
  }: {
    children: ReactNode;
    options?: ActorOptions<TLogic> & WithDebug;
    machine?: never;
    logic?: TLogic;
  }) {
    if (machine) {
      throw new Error(`The "machine" prop has been deprecated. Please use "logic" instead.`);
    }

    // SAFETY: The proxy stands in for the actor @xstate/react made from the logic, so it has the logic's types.
    const actor = useProxiedActorRef(providedLogic, { ...actorOptions, ...providedOptions }) as Actor<TLogic>;

    return createElement(OriginalProvider, { value: actor, children });
  }

  Provider.displayName = `ActorProvider`;

  function useContextActorRef() {
    const actor = useContext(ReactContext);

    if (!actor) {
      throw new Error(
        `You used a hook from "${Provider.displayName}" but it's not inside a <${Provider.displayName}> component.`,
      );
    }

    return actor;
  }

  function useContextSelector<T>(selector: (snapshot: SnapshotFrom<TLogic>) => T, compare?: (a: T, b: T) => boolean) {
    const actor = useContextActorRef();

    return useSelector(actor, selector, compare);
  }

  // oxlint-disable-next-line anti-slop/no-known-value-widening -- The return type is public, as @xstate/react has it.
  return {
    Provider,
    useActorRef: useContextActorRef,
    useSelector: useContextSelector,
  };
}
