// Actors created outside React.

import type { AnyActorRef } from 'xstate';
import { isMachineActor } from './actor';
import { nextInstanceId, resolveMachineId } from './identity';
import type { DebugOptions } from './options';
import { findBinding, getBinding, isProxy } from './proxy';

// Proxies made here, and hook proxies already warned about.
const connected = new WeakSet<object>();
const warned = new WeakSet<object>();

/**
 * Registers an actor created outside React and returns its proxy; use the proxy wherever the app reads the actor.
 * The actor is registered at once and unregistered when it's done, failed or stopped. Actors that aren't machines,
 * that already stopped or that have `disabled` set come back unchanged. An actor connected before, or created by one
 * of the hooks, gets the proxy it already has without registering again; so does a proxy.
 */
export function connect<TActor extends AnyActorRef>(actor: TActor, options?: DebugOptions): TActor {
  if (isProxy(actor)) return existing(actor, options);
  if (options?.disabled || !isMachineActor(actor)) return actor;
  const binding = findBinding(actor);
  if (binding) return existing(binding.proxy, options);
  if ((actor.getSnapshot() as { status?: string } | undefined)?.status !== 'active') return actor;

  const created = getBinding(actor);
  connected.add(created.proxy);
  created
    .registration({ machineId: resolveMachineId(actor.logic, options?.id), instanceId: nextInstanceId(), label: options?.label })
    .connect({ untilStopped: true });
  return created.proxy;
}

/** A hook's proxy keeps the hook's id and label; one connect() made doesn't need telling. */
function existing<TActor extends AnyActorRef>(proxy: TActor, options: DebugOptions | undefined): TActor {
  if (connected.has(proxy) || warned.has(proxy)) return proxy;
  if (options?.id === undefined && options?.label === undefined) return proxy;
  warned.add(proxy);
  console.warn(
    `[state-viewer] connect() was given an actor that a hook already registers, so it keeps the hook's id and label.`,
  );
  return proxy;
}
