import type { ActorOptions, AnyActorLogic, RequiredActorOptionsKeys } from 'xstate';

export type DebugOptions = {
  /** Machine id in the registry; defaults to `machine.id`. */
  id?: string;
  /** Display name in the panel. */
  label?: string;
  /** Keep this actor out of the debugger. */
  disabled?: boolean;
};

/** The one option the hooks add to XState's; it's stripped before the options reach XState (§8.2). */
export interface WithDebug {
  debug?: DebugOptions;
}

/** XState's actor options, with the keys the logic requires (such as `input`) and `debug`. */
export type HookActorOptions<TLogic extends AnyActorLogic> = ActorOptions<TLogic> & {
  [K in RequiredActorOptionsKeys<TLogic>]: unknown;
} & WithDebug;
