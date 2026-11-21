import type { ActorOptions, AnyActorLogic, RequiredActorOptionsKeys } from 'xstate';

export type DebugOptions = {
  /** Machine id in the registry; defaults to `machine.id`. */
  id?: string;
  /** Display name in the panel. */
  label?: string;
  /** Keep this actor out of the debugger. */
  disabled?: boolean;
};

/** The hooks remove `debug` before the options reach XState. */
export interface WithDebug {
  debug?: DebugOptions;
}

/** XState's actor options, with the keys that the logic requires (such as `input`) and `debug`. */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- The type is public. unknown makes each key required, and ActorOptions types it.
export type HookActorOptions<TLogic extends AnyActorLogic> = ActorOptions<TLogic> & {
  [K in RequiredActorOptionsKeys<TLogic>]: unknown;
} & WithDebug;
