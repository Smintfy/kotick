// Typed helpers for values that XState and React give to the tests without a precise type.

import type { DebugOptions } from 'state-viewer/xstate';
import type { ActorOptions, AnyActorLogic, AnyActorRef } from 'xstate';

/**
 * The options of a hook with `debug`, in a type that the hooks of @xstate/react also accept.
 * @xstate/react ignores `debug`, so a test can give these options to the hooks of both packages.
 */
export function withDebug(debug: DebugOptions): ActorOptions<AnyActorLogic> & { debug: DebugOptions } {
  return { debug };
}

/** The message of an error that an observer or the page received. A thrown value can be of any type. */
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The actor that the system of `actor` holds under `systemId`.
 * If the system has no such actor, the test fails here, not at a later call on `undefined`.
 */
export function systemActor(actor: AnyActorRef, systemId: string): AnyActorRef {
  const found = actor.system.get(systemId);

  if (found === undefined) throw new Error(`The system has no actor "${systemId}".`);

  return found;
}
