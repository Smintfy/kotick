// The hook half of the app runtime. Production builds keep it.
// It imports nothing from shiru except the definition module.

import { useEffect, useInsertionEffect, useMemo, useReducer, useRef, useState } from 'react';
import { effectOf, type MachineEvent, type MachineReducerArgs, type ReducerMachine } from './machine';

/**
 * What useReducer holds: the state of the app, and a token for the entry into that state.
 * A transition that changes the state name makes a new token, also inside one batch, and the effect keys on it.
 * A transition that keeps the name keeps the token.
 * The token is an object, not a count, because React can compute an entry again from an older state.
 * The two results then have the same count, and they can have the same name, but they are different states.
 * The step gives the same object each time React applies the same event object to the same object.
 * So a token changes only when the entry comes from a different object, not on each render.
 */
interface Entered<State> {
  readonly state: State;
  readonly entry: object;
}

function isInitializer<State>(value: State | (() => State)): value is () => State {
  return typeof value === 'function';
}

function enter<State>(initial: State | (() => State)): Entered<State> {
  return { state: isInitializer(initial) ? initial() : initial, entry: {} };
}

/**
 * Runs the effect of the real state from a passive effect, keyed on the machine and the entry token.
 * React's effect rules apply. StrictMode runs the effect, its cleanup and the effect again on mount.
 * A hidden Activity runs the cleanup, and a reveal starts the effect again.
 * A Suspense boundary that hides the component keeps the effect running.
 * A batch of events that enters and leaves a state in one render runs no effect for that state.
 * A batch that leaves a state and enters it again runs the cleanup and starts the effect again.
 * While a transition update stays pending, React computes each later update again on each render.
 * The step gives the same token for the same event from the same state object, so the effect keeps running.
 * React can apply a transition update again from an older state after it commits a later update.
 * An entry that comes after that update then starts from a different state object and gets a new token.
 * So the effect starts again with the committed state, also when the new state is equal to the state before it.
 */
function useStateEffect<State extends object, Event extends MachineEvent, Key extends keyof State, Input>(
  machine: ReducerMachine<State, Event, Key, Input>,
  { state, entry }: Entered<State>,
  dispatch: (event: Event) => void,
  input: () => Input,
): void {
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
  }, [machine, entry]);
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
  // machine.reducer stays the plain reducer over the app's state. This step adds the entry token around it.
  // The step keeps each result that changes the state, by the object that it started from and by the event object.
  // React applies one event to each such object, so each map holds one result, or some around a transition.
  // An event that the state ignores gives the object itself, so the step keeps no result for it.
  // A new machine from Fast Refresh makes a new step with no results.
  const step = useMemo(() => {
    const results = new WeakMap<Entered<State>, Map<Event, Entered<State>>>();

    return (current: Entered<State>, event: Event): Entered<State> => {
      // The handler runs on each call, as in a plain reducer, so StrictMode still shows a handler that isn't pure.
      // When the step has a result for this object and event, it gives that result and drops the new state.
      const state = machine.reducer(current.state, event);

      if (Object.is(state, current.state)) return current;
      let known = results.get(current);

      if (!known) results.set(current, (known = new Map()));
      let result = known.get(event);

      if (!result) {
        const left = state[machine.discriminant] !== current.state[machine.discriminant];

        known.set(event, (result = { state, entry: left ? {} : current.entry }));
      }

      return result;
    };
  }, [machine]);

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
