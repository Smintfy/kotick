'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createActor, type AnyActorRef, type AnyStateMachine } from 'xstate';
import { useHost } from './components/kotick';
import { Overlay } from './components/overlay';
import { nextInstanceId } from './core/instance-id';
import { createRegistry, toInstanceKey } from './core/registry';
import { createInstance } from './reducer/dev-hook';
import type { MachineEvent, ReducerMachine } from './reducer/machine';
import type { DataSource, FixtureSet, Position, Registry } from './types';
import type { Settings, SettingsStore } from './utils/settings';
import { isMachineActor } from './xstate/actor';
import { createHandle, inspect } from './xstate/handle';
import { resolveMachineId } from './xstate/identity';

/** The page that the figure shows. It is the overlay's PanelPage, with ids in place of the registry's objects. */
export type FigurePage =
  | { kind: 'machines' }
  | { kind: 'settings' }
  | { kind: 'machine'; machineId: string; preview?: { leaves: string[]; source?: DataSource } };

export interface KotickFigureProps {
  /** Each XState machine gets one running actor, in its initial state. */
  machines?: readonly AnyStateMachine[];
  /** Each reducer machine gets one instance, in the state that `figureReducer()` gives it. */
  reducers?: readonly FigureReducer[];
  fixtures?: readonly FixtureSet[];
  page: FigurePage;
  position?: Position;
  portalTarget: Element | ShadowRoot;
}

/** A machine that the figure registered. */
interface StartedMachine {
  machineId: string;
  key: string;
  stop(): void;
}

/** A reducer machine and the state of its instance. Make it with `figureReducer()`. */
export interface FigureReducer {
  start(registry: Registry): StartedMachine;
}

/**
 * The real panel, open on one page, for the docs.
 * It has its own registry, so it shows only its own machines, and it reads and writes no storage.
 * It reads `machines`, `reducers`, `fixtures` and `page` when it mounts. Give it a new `key` to show others.
 * It does not stop clicks or keys. The page around it must make it read-only, for example with `inert`.
 */
export function KotickFigure(props: KotickFigureProps): ReactNode {
  const [scene] = useState(() => createScene(props));
  useEffect(() => scene.start(), [scene]);
  const host = useHost(props.portalTarget);

  return (
    host &&
    createPortal(
      <Overlay
        registry={scene.registry}
        host={host}
        settings={scene.settings}
        defaultSubpage={props.page.kind === 'settings' ? 'settings' : undefined}
        defaultOpen
        shortcut={false}
        position={props.position}
      />,
      host.container,
    )
  );
}

/**
 * A reducer machine for `reducers`, with the state of its instance.
 * The figure sends no events, so the instance stays in this state.
 */
export function figureReducer<State extends object, Event extends MachineEvent, Key extends keyof State, Input>(
  machine: ReducerMachine<State, Event, Key, Input>,
  state: NoInfer<State>,
): FigureReducer {
  return {
    // In the order of useMachineReducer(): the publish, the registration, then the recording.
    // The registry drops a recording for a key that it doesn't hold.
    start(registry) {
      const instanceId = nextInstanceId();
      const key = toInstanceKey(machine.id, instanceId);
      const { handle, publish } = createInstance(machine, instanceId, undefined);
      publish(state);
      const stop = registry.register(handle);
      registry.record(key, [String(state[machine.discriminant])], state);

      return { machineId: machine.id, key, stop };
    },
  };
}

function createScene({ machines = [], reducers = [], fixtures, page }: KotickFigureProps) {
  const registry = createRegistry({ recordings: 'memory', fixtures });
  const seed: Settings = page.kind === 'machine' ? { machine: page.machineId } : {};

  // A change stays in the overlay's state only.
  const settings: SettingsStore = { read: () => seed, write: () => {} };

  function start(): () => void {
    const started = [
      ...machines.map((machine) => startMachine(registry, machine)),
      ...reducers.map((reducer) => reducer.start(registry)),
    ];

    if (page.kind === 'machine' && page.preview) {
      const shown = started.find((entry) => entry.machineId === page.machineId);

      if (shown) registry.preview(shown.key, page.preview);
    }

    return () => {
      for (const entry of started) entry.stop();
    };
  }

  return { registry, settings, start };
}

/** Starts an actor of the machine and registers it as the hooks do, but in the figure's registry. */
function startMachine(registry: Registry, machine: AnyStateMachine): StartedMachine {
  // An actor ref rather than XState's Actor, whose private _error keeps it from narrowing to a MachineActor.
  const actor: AnyActorRef = createActor(machine).start();

  if (!isMachineActor(actor)) throw new Error('[kotick] KotickFigure takes only machines.');
  const identity = { machineId: resolveMachineId(machine), instanceId: actor.sessionId };
  const key = toInstanceKey(identity.machineId, identity.instanceId);
  const { handle, notify, record } = createHandle(actor, machine, identity, undefined, true, registry);
  const unregister = registry.register(handle);
  record(actor.getSnapshot());

  const stopInspecting = inspect(actor, key, registry, (snapshot) => {
    record(snapshot);
    notify();
  });

  return {
    machineId: identity.machineId,
    key,
    stop() {
      stopInspecting();
      unregister();
      actor.stop();
    },
  };
}
