// The hook half of the app runtime. Production builds keep it.
// It imports nothing from konat except the definition module.

import { useCallback, useEffect, useInsertionEffect, useReducer, useRef, useState } from 'react';
import { effectOf, type MachineEvent, type MachineReducerArgs, type ReducerMachine } from './machine';

/**
 * What useReducer holds: the state of the app, and the number of times the machine entered a state.
 * `entry` grows when a transition changes the state name, also inside one batch, so the effect can key on it.
 */
interface Entered<State> {
  readonly state: State;
  readonly entry: number;
}

function isInitializer<State>(value: State | (() => State)): value is () => State {
  return typeof value === 'function';
}

function enter<State>(initial: State | (() => State)): Entered<State> {
  return { state: isInitializer(initial) ? initial() : initial, entry: 0 };
}

/**
 * Runs the effect of the real state from a passive effect, keyed on the machine, the entry count and the state name.
 * React's effect rules apply. StrictMode runs the effect, its cleanup and the effect again on mount.
 * A hidden Activity runs the cleanup, and a reveal starts the effect again.
 * A Suspense boundary that hides the component keeps the effect running.
 * A batch of events that enters and leaves a state in one render runs no effect for that state.
 * A batch that leaves a state and enters it again runs the cleanup and starts the effect again.
 * React can apply a transition update again from an older state after it commits a later update.
 * Two commits can then have the same count and different names, and the name in the key restarts the effect there.
 */
function useStateEffect<State extends object, Event extends MachineEvent, Key extends keyof State, Input>(
  machine: ReducerMachine<State, Event, Key, Input>,
  { state, entry }: Entered<State>,
  dispatch: (event: Event) => void,
  input: () => Input,
): void {
  const name = state[machine.discriminant];

  // A restart without a new entry, such as an Activity reveal, gives the effect the state of the newest commit.
  // The effect reads the input through `input()`, so the input isn't a key.
  useEffect(() => {
    const effect = effectOf(machine, state);

    if (effect === undefined) return undefined;
    let entered = true;

    const cleanup = effect(
      state,
      (event) => {
        if (entered) dispatch(event);
      },
      input,
    );

    return () => {
      entered = false;

      if (cleanup) cleanup();
    };
  }, [machine, entry, name]);
}

/**
 * The production hook: React's useReducer over the compiled reducer, and the effect of the real state.
 * `initial` is the state at mount, or a function that returns it, as for useReducer.
 * NoInfer makes TypeScript take the union and the input type from the machine and check the arguments against them.
 */
export function useMachineReducer<
  State extends object,
  Event extends MachineEvent,
  Key extends keyof State,
  Input = undefined,
>(
  machine: ReducerMachine<State, Event, Key, Input>,
  initial: NoInfer<State | (() => State)>,
  ...[options]: NoInfer<MachineReducerArgs<Input>>
): [state: State, dispatch: (event: Event) => void] {
  // machine.reducer stays the plain reducer over the app's state. This step adds the entry count around it.
  const step = useCallback(
    (current: Entered<State>, event: Event): Entered<State> => {
      const state = machine.reducer(current.state, event);

      if (Object.is(state, current.state)) return current;
      const left = state[machine.discriminant] !== current.state[machine.discriminant];

      return { state, entry: left ? current.entry + 1 : current.entry };
    },
    [machine],
  );

  const [entered, dispatch] = useReducer(step, initial, enter);
  const latest = useRef(options?.input);

  // Before any layout or passive effect of the commit, so an effect that starts in this commit reads this input.
  // useLayoutEffect warns on the server in React 18, and an insertion effect doesn't.
  useInsertionEffect(() => {
    latest.current = options?.input;
  });

  // An effect calls `input()` when it needs the value, so a callback that runs later reads the newest input.
  // SAFETY: The options type requires `input` when the machine declares an input type. Without one, Input is undefined.
  const [input] = useState(() => (): Input => latest.current as Input);
  useStateEffect(machine, entered, dispatch, input);

  return [entered.state, dispatch];
}
