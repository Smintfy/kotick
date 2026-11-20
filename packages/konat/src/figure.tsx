'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createActor, type AnyActorRef, type AnyStateMachine } from 'xstate';
import { useHost } from './components/konat';
import { Overlay } from './components/overlay';
import { createRegistry, toInstanceKey } from './core/registry';
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

export interface KonatFigureProps {
  /** Each machine gets one running actor, in its initial state. */
  machines: readonly AnyStateMachine[];
  fixtures?: readonly FixtureSet[];
  page: FigurePage;
  position?: Position;
  portalTarget: Element | ShadowRoot;
}

/**
 * The real panel, open on one page, for the docs.
 * It has its own registry, so it shows only its own machines, and it reads and writes no storage.
 * It reads `machines`, `fixtures` and `page` when it mounts. Give it a new `key` to show others.
 * It does not stop clicks or keys. The page around it must make it read-only, for example with `inert`.
 */
export function KonatFigure(props: KonatFigureProps): ReactNode {
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

function createScene({ machines, fixtures, page }: KonatFigureProps) {
  const registry = createRegistry({ recordings: 'memory', fixtures });
  const seed: Settings = page.kind === 'machine' ? { machine: page.machineId } : {};

  // A change stays in the overlay's state only.
  const settings: SettingsStore = { read: () => seed, write: () => {} };

  function start(): () => void {
    const started = machines.map((machine) => startMachine(registry, machine));

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
function startMachine(registry: Registry, machine: AnyStateMachine) {
  // An actor ref rather than XState's Actor, whose private _error keeps it from narrowing to a MachineActor.
  const actor: AnyActorRef = createActor(machine).start();

  if (!isMachineActor(actor)) throw new Error('[konat] KonatFigure takes only machines.');
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
