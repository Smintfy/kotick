// What the adapter reads from an XState actor and its snapshots.

import type { AnyActorRef, AnyStateMachine } from 'xstate';
import { isMachine } from './tree';

export type MachineActor = AnyActorRef & {
  logic: AnyStateMachine;
  sessionId: string;
  _send(event: unknown): void;
  /** Private in XState. Every failure goes through it, whether a transition, start() or an initial action throws. */
  _error(error: unknown): void;
};

export const EMPTY_CHILDREN: Readonly<Record<string, AnyActorRef>> = /* @__PURE__ */ Object.freeze({});

export function isMachineActor(actor: unknown): actor is MachineActor {
  return (
    typeof actor === 'object' &&
    actor !== null &&
    typeof (actor as AnyActorRef).getSnapshot === 'function' &&
    isMachine((actor as { logic?: unknown }).logic)
  );
}

export function statusOf(snapshot: unknown): unknown {
  return (snapshot as { status?: unknown } | null | undefined)?.status;
}

export function liveChildren(snapshot: unknown): Readonly<Record<string, AnyActorRef>> {
  const children = (snapshot as { children?: unknown } | null | undefined)?.children;

  return typeof children === 'object' && children !== null ? (children as Record<string, AnyActorRef>) : EMPTY_CHILDREN;
}
