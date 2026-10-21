// What the adapter reads from an XState actor and its snapshots.

import {
  isMachineSnapshot,
  type ActorRef,
  type AnyActorRef,
  type AnyEventObject,
  type AnyStateMachine,
  type Snapshot,
} from 'xstate';
import { isMachine } from './tree';

/**
 * A running actor of a machine. Its snapshot is typed by what every XState snapshot has: an actor that fails on
 * start has a snapshot with only a status and an error, and no value, context or children.
 */
export type MachineActor = ActorRef<Snapshot<unknown>, AnyEventObject, AnyEventObject> & {
  logic: AnyStateMachine;
  /** What sendTo, forwardTo and delayed sends call on their target. XState's types don't declare it. */
  _send(event: AnyEventObject): void;
  /** Private in XState. Every failure goes through it, whether a transition, start() or an initial action throws. */
  _error(cause: unknown): void;
};

/** The child actors a machine snapshot lists, by their ids. */
export type ChildActors = Readonly<Record<string, AnyActorRef>>;

export const EMPTY_CHILDREN: ChildActors = /* @__PURE__ */ Object.freeze({});

export function isMachineActor(actor: unknown): actor is MachineActor {
  return (
    typeof actor === 'object' &&
    actor !== null &&
    'getSnapshot' in actor &&
    typeof actor.getSnapshot === 'function' &&
    'logic' in actor &&
    isMachine(actor.logic)
  );
}

export function liveChildren(snapshot: Snapshot<unknown>): ChildActors {
  return isMachineSnapshot(snapshot) ? snapshot.children : EMPTY_CHILDREN;
}
