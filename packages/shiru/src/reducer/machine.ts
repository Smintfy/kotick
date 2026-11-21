// The definition half of the app runtime. Production builds keep it.
// It imports nothing and has no directive, so a server component or a route handler can import a machine file.

/** An event is an object with a string `type`. */
export type MachineEvent = { readonly type: string };

type IsNameUnion<T> = [T] extends [string] ? (string extends T ? false : true) : false;

/**
 * The keys whose value is a string literal, or a union of string literals, in every member of the union.
 * Only such a key can name the states, because its values are a finite set of names.
 */
export type DiscriminantKey<State> = keyof State extends infer Key
  ? Key extends keyof State
    ? IsNameUnion<State[Key]> extends true
      ? Key
      : never
    : never
  : never;

/** The state names, which are the values of the discriminant. */
export type StateName<State, Key extends keyof State> = Extract<State[Key], string>;

/**
 * The members that can be in the state `Name`, with the discriminant set to `Name`.
 * A member whose discriminant is a union, such as `'saving' | 'deleting'`, belongs to each of those states.
 */
export type StateNamed<State, Key extends keyof State, Name> = State extends unknown
  ? Name extends State[Key]
    ? [State[Key]] extends [Name]
      ? State
      : Omit<State, Key> & Record<Key, Name>
    : never
  : never;

/** The member of the event union with this `type`. */
export type EventTyped<Event extends MachineEvent, Type> = Extract<Event, { readonly type: Type }>;

/** Returns the next state. Return `state` to ignore the event. A transition gets no input, because it must be pure. */
export type Transition<From, Event, State> = (state: From, event: Event) => State;

/**
 * Starts after the commit that enters the state, with the state of that commit.
 * A restart within the state, such as an Activity reveal, StrictMode or a Fast Refresh edit, gets the newest state.
 * Its cleanup runs after the commit that leaves the state, and when the component unmounts.
 * A batch that leaves the state and enters it again in one render also runs the cleanup and starts the effect again.
 * `send` goes to the real machine, also during a preview. After the cleanup, `send` does nothing.
 * `input()` returns the newest input that the component gave the hook. A new input doesn't restart the effect.
 * A transition that keeps the state name keeps the effect running.
 */
export type StateEffect<From, Event, Input> = (
  state: From,
  send: (event: Event) => void,
  input: () => Input,
) => void | (() => void);

export interface StateDefinition<From, State, Event extends MachineEvent, Input> {
  /** The events that the state handles. The state ignores every other event. */
  readonly on?: { readonly [Type in Event['type']]?: Transition<From, EventTyped<Event, Type>, State> };
  readonly effect?: StateEffect<From, Event, Input>;
}

/** One definition for each state name, and no other key. */
export type StateDefinitions<State, Event extends MachineEvent, Key extends keyof State, Input> = {
  readonly [Name in StateName<State, Key>]: StateDefinition<StateNamed<State, Key, Name>, State, Event, Input>;
};

export interface ReducerMachineDefinition<State, Event extends MachineEvent, Key extends keyof State, Input> {
  /** The machine id on the page. The panel, the recordings and the fixtures find the machine by it. */
  readonly id: string;
  /** The key whose value is the state name. TypeScript infers `Key` from this literal. */
  readonly discriminant: Key;
  /** The panel lists the states in this order. */
  readonly states: StateDefinitions<State, Event, Key, Input>;
}

export interface ReducerMachine<State, Event extends MachineEvent, Key extends keyof State, Input = undefined>
  extends ReducerMachineDefinition<State, Event, Key, Input> {
  /**
   * The transitions as a plain reducer, for tests.
   * It returns the same object for an event that the state ignores.
   * Components use useMachineReducer(), which also runs the effects.
   */
  readonly reducer: (state: State, event: Event) => State;
}

export interface MachineReducerOptions<Input = undefined> {
  /** The value that `input()` returns in the effects. The hook requires it when the machine declares an input type. */
  readonly input?: Input;
  /** shiru reads these options in development builds only. */
  readonly debug?: {
    /** The name of this instance in the panel. */
    readonly label?: string;
    /** Keeps this instance out of shiru. */
    readonly disabled?: boolean;
  };
}

/** The options argument of the hook: optional for a machine with no input, and required with `input` for one with an input. */
export type MachineReducerArgs<Input> = [Input] extends [undefined]
  ? [options?: MachineReducerOptions]
  : [options: MachineReducerOptions<Input> & { readonly input: Input }];

/**
 * The handlers of one state as the reducer calls them.
 * The definition keys each handler by the name of its state and the type of its event.
 * The reducer finds a handler by the name of `state` and the type of `event`, so the handler takes both.
 * TypeScript can't relate a key to a parameter type, so the guards below state it.
 */
type Handlers<State, Event> = { readonly [type: string]: Transition<State, Event, State> | undefined };

/**
 * Declares a machine over the union of states and the union of events that the app already writes.
 * The first call takes the two unions, and the type of the input that the effects read, if they read one.
 * The second call takes the definition and infers the discriminant from it.
 * TypeScript can't take some type arguments of one call from the caller and infer the others, so there are two calls.
 */
export function defineReducerMachine<State extends object, Event extends MachineEvent, Input = undefined>() {
  return <Key extends DiscriminantKey<State>>(
    definition: ReducerMachineDefinition<State, Event, Key, Input>,
  ): ReducerMachine<State, Event, Key, Input> => Object.freeze({ ...definition, reducer: compile(definition) });
}

/** Whether `name` is a state of the definition. */
export function isDeclared<State, Event extends MachineEvent, Key extends keyof State, Input>(
  definition: ReducerMachineDefinition<State, Event, Key, Input>,
  name: unknown,
): name is StateName<State, Key> {
  // Production browsers run this module, and Object.hasOwn() needs Safari 15.4 or Chrome 93.
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(definition.states, name);
}

/** Whether `value` is a state object whose discriminant is `name`. A preview and a fixture set both check it. */
export function isStateOf<State, Event extends MachineEvent, Key extends keyof State, Input>(
  definition: ReducerMachineDefinition<State, Event, Key, Input>,
  value: unknown,
  name: string,
): value is State {
  return isReadable<State>(value) && value[definition.discriminant] === name;
}

/** The effect of the state that `state` is in, or undefined. */
export function effectOf<State extends object, Event extends MachineEvent, Key extends keyof State, Input>(
  definition: ReducerMachineDefinition<State, Event, Key, Input>,
  state: State,
): StateEffect<State, Event, Input> | undefined {
  const name = state[definition.discriminant];

  if (!isDeclared(definition, name)) return undefined;
  const effect = definition.states[name].effect;

  return isEffect<State, Event, Input>(effect) ? effect : undefined;
}

function compile<State extends object, Event extends MachineEvent, Key extends keyof State, Input>(
  definition: ReducerMachineDefinition<State, Event, Key, Input>,
): (state: State, event: Event) => State {
  return (state, event) => {
    const name = state[definition.discriminant];

    // React calls a reducer during render, so an event without a string type from JavaScript is ignored, not thrown.
    if (!isDeclared(definition, name) || !isEventObject(event)) return state;
    const on = definition.states[name].on;

    // An inherited property, such as `constructor`, is no handler.
    if (!isHandlers<State, Event>(on) || !Object.prototype.hasOwnProperty.call(on, event.type)) return state;
    const transition = on[event.type];

    return transition === undefined ? state : transition(state, event);
  };
}

function isHandlers<State, Event>(value: unknown): value is Handlers<State, Event> {
  return typeof value === 'object' && value !== null;
}

function isEffect<State, Event, Input>(value: unknown): value is StateEffect<State, Event, Input> {
  return typeof value === 'function';
}

function isEventObject(value: unknown): value is MachineEvent {
  return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';
}

// The state name is the one fact that shiru checks of a state object. No fixture or recording has a schema.
function isReadable<State>(value: unknown): value is Partial<State> {
  return typeof value === 'object' && value !== null;
}
