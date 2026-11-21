// The development hook. It runs the production hook, so both builds have one runtime.
// It adds the registry: the handle, the recordings, the preview and the blocked events.
// It is the only module of the reducer adapter that touches the registry.

import { useCallback, useEffect, useInsertionEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { blockIfPreviewing } from '../core/blocking';
import { nextInstanceId } from '../core/instance-id';
import { callLoggingErrors, getPageRegistry, toInstanceKey } from '../core/registry';
import { warnOnce } from '../core/warn-once';
import { useIsomorphicLayoutEffect } from '../shared-hooks/use-isomorphic-layout-effect';
import { useSnapshotCheck } from '../shared-hooks/use-snapshot-check';
import type { Capabilities, MachineHandle, Override, StateNodeInfo } from '../types';
import { isDeclared, isStateOf, type MachineEvent, type MachineReducerArgs, type ReducerMachine } from './machine';
import { useMachineReducer as useRuntime } from './runtime';

// The states of a union share no context, so the live context fits only the state that the machine is in.
const CAPABILITIES: Capabilities = /* @__PURE__ */ Object.freeze({ preview: true, sharedContext: false });

export interface ReducerInstance<State> {
  readonly handle: MachineHandle;
  /** The only writer of the state that the handle reads. The layout effect of the hook calls it after each commit. */
  publish(state: State): void;
}

/** Makes the handle of one instance, as the registry sees it, and the one function that writes its real state. */
export function createInstance<State extends object, Event extends MachineEvent, Key extends keyof State, Input>(
  machine: ReducerMachine<State, Event, Key, Input>,
  instanceId: string,
  label: string | undefined,
): ReducerInstance<State> {
  let committed: State | undefined;
  const listeners = new Set<() => void>();

  // The states of a union are flat, so the id of a node is its key.
  const nodes = Object.keys(machine.states).map(
    (name): StateNodeInfo => ({ id: name, key: name, type: 'atomic', children: [] }),
  );

  const handle: MachineHandle = {
    machineId: machine.id,
    instanceId,
    capabilities: CAPABILITIES,
    definitionId: machine.id,
    describe: () => nodes,
    getActiveLeaves: () => {
      const name = committed?.[machine.discriminant];

      return isDeclared(machine, name) ? [name] : [];
    },
    // The state object itself, so a recording and the Context view cost no copy.
    getContext: () => committed,
    subscribe(onChange) {
      listeners.add(onChange);

      return () => {
        listeners.delete(onChange);
      };
    },
    normalizeTarget: (leaves) => ({ requested: leaves.slice(0, 1), filled: [] }),
  };

  if (label !== undefined) handle.label = label;

  return {
    handle: Object.freeze(handle),
    publish(state) {
      if (Object.is(state, committed)) return;
      committed = state;

      for (const listener of Array.from(listeners)) {
        if (listeners.has(listener)) callLoggingErrors(listener, `A listener of "${machine.id}" threw.`);
      }
    },
  };
}

/**
 * The state that a preview gives the component, or undefined to show the real state.
 * It is the one rule for what the app shows during a preview: the render reads it, and so does dispatch.
 * It checks only the state name and the discriminant. It can't see a field that an edit added to a state.
 */
export function previewState<State extends object, Event extends MachineEvent, Key extends keyof State, Input>(
  machine: ReducerMachine<State, Event, Key, Input>,
  override: Override | undefined,
): State | undefined {
  if (override === undefined) return undefined;
  const name = override.requested[0];
  const context = override.context;

  return isDeclared(machine, name) && isStateOf(machine, context, name) ? context : undefined;
}

/** The warning when the hook ends a preview that the app can't show. */
function endedPreview<State, Event extends MachineEvent, Key extends keyof State, Input>(
  machine: ReducerMachine<State, Event, Key, Input>,
  override: Override,
): string {
  const name = String(override.requested[0]);
  const ended = `[konat] Ended the preview of "${name}" on "${override.instanceKey}"`;

  if (!isDeclared(machine, name)) return `${ended}, because "${machine.id}" has no state "${name}".`;

  return (
    `${ended}, because its ${override.source} context isn't in the "${name}" state. ` +
    "An older copy of konat on the page, or a fixture set that defineFixtures() didn't make, can cause this."
  );
}

/** The instance key and the machine of the last commit, which dispatch() reads when an event comes. */
interface Committed<State, Event extends MachineEvent, Key extends keyof State, Input> {
  readonly key: string | undefined;
  readonly machine: ReducerMachine<State, Event, Key, Input>;
}

export function useDevMachineReducer<
  State extends object,
  Event extends MachineEvent,
  Key extends keyof State,
  Input = undefined,
>(
  machine: ReducerMachine<State, Event, Key, Input>,
  initial: NoInfer<State | (() => State)>,
  ...args: NoInfer<MachineReducerArgs<Input>>
): [state: State, dispatch: (event: Event) => void] {
  const [real, dispatchReal] = useRuntime(machine, initial, ...args);
  // Not useId(): roots that hydrate apart can repeat its values.
  const [instanceId] = useState(nextInstanceId);
  const committed = useRef<Committed<State, Event, Key, Input>>(undefined);
  const registry = getPageRegistry();
  const label = args[0]?.debug?.label;
  const disabled = args[0]?.debug?.disabled === true;

  // A new machine object, from a Fast Refresh edit, makes a new handle with the new list of states.
  const instance = useMemo(
    () => (disabled ? undefined : createInstance(machine, instanceId, label)),
    [machine, instanceId, label, disabled],
  );

  const key = instance === undefined ? undefined : toInstanceKey(machine.id, instanceId);
  const readOverride = useCallback(() => (key === undefined ? undefined : registry.getOverride(key)), [registry, key]);

  const subscribe = useCallback(
    (onChange: () => void) => (key === undefined ? noop : registry.onOverride(key, onChange)),
    [registry, key],
  );

  const override = useSyncExternalStore(subscribe, readOverride, noOverride);

  // An insertion effect runs before every layout effect of the commit.
  // The layout effect of a child runs before the layout effect of this component.
  // So a dispatch from the layout effect of a child reads the key and the machine of its own commit.
  useInsertionEffect(() => {
    committed.current = { key, machine };
  });
  useIsomorphicLayoutEffect(() => {
    instance?.publish(real);
  });
  useSnapshotCheck(readOverride, override);

  // Passive, so StrictMode, Fast Refresh and Activity unregister and register again in one tick, and the preview stays.
  useEffect(() => (instance === undefined ? undefined : registry.register(instance.handle)), [registry, instance]);
  // After the registration, because the registry drops a recording for a key that it doesn't hold.
  useEffect(() => {
    if (key === undefined) return;
    const name = real[machine.discriminant];

    if (isDeclared(machine, name)) {
      registry.record(key, [name], real);

      return;
    }

    const state = String(name);
    warnOnce(
      `undeclared:${machine.id}:${state}`,
      `[konat] "${machine.id}" is in "${state}", which its definition doesn't declare.`,
    );
  }, [registry, key, machine, real]);
  // The app shows the real state for an override that previewState() refuses, so this effect ends that override.
  // The panel then shows the real state too.
  // It reads the current override of the registry, so it never ends a newer preview that the app can show.
  // It runs after the registration. So register() ends the preview of a state that an edit removed, with no warning here.
  // warnOnce() keys on the override object, so the second run of StrictMode doesn't warn again.
  // After the release the key has no override, so the effect can't loop.
  useEffect(() => {
    if (key === undefined) return;
    const current = registry.getOverride(key);

    if (current === undefined || previewState(machine, current) !== undefined) return;
    warnOnce(current, endedPreview(machine, current));
    registry.release(key);
  }, [registry, key, machine, override]);

  // One function for the life of the component, as the dispatch of React is.
  // It reads the override when the event comes, and it blocks by the rule of the render: only when the app shows a preview.
  const [dispatch] = useState(() => (event: Event): void => {
    const shown = committed.current;
    const current = shown?.key === undefined ? undefined : registry.getOverride(shown.key);

    const previewing = shown !== undefined && previewState(shown.machine, current) !== undefined;

    if (previewing && blockIfPreviewing(registry, current, event)) return;

    dispatchReal(event);
  });

  return [previewState(machine, override) ?? real, dispatch];
}

function noop(): void {}

function noOverride(): undefined {
  return undefined;
}
