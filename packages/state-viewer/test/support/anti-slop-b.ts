// Typed helpers for values that XState and React give to the tests without a precise type.

import type { AnyActorRef } from 'xstate';

/**
 * The actor that the system of `actor` holds under `systemId`.
 * If the system has no such actor, the test fails here, not at a later call on `undefined`.
 */
export function systemActor(actor: AnyActorRef, systemId: string): AnyActorRef {
  const found = actor.system.get(systemId);

  if (found === undefined) throw new Error(`The system has no actor "${systemId}".`);

  return found;
}
