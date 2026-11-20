import { act, render, screen } from '@testing-library/react';
import { useReducer } from 'react';
import { defineReducerMachine, useMachineReducer, type ReducerMachine } from 'konat/reducer';
import { describe, expect, test } from 'vitest';
import { press } from '../support/app';
import { freshId } from '../support/panel';

type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string; progress: number }
  | { status: 'ready'; query: string; result: string }
  | { status: 'failed'; message: string };

type SearchEvent =
  | { type: 'SEARCH'; query: string }
  | { type: 'PROGRESS'; progress: number }
  | { type: 'RESOLVE'; result: string }
  | { type: 'CANCEL' }
  | { type: 'FAIL'; message: string };

/** What the effect of `loading` reads from its component. */
interface SearchInput {
  tag: string;
}

/** A search that the server didn't answer yet. The test answers it with `respond()`. */
interface SearchRequest {
  query: string;
  respond(): void;
}

interface Server {
  /** What the effect of `loading` did, in order. */
  log: string[];
  requests: SearchRequest[];
}

type SearchMachine = ReducerMachine<SearchState, SearchEvent, 'status', SearchInput>;

const IDLE: SearchState = { status: 'idle' };

function createServer(): Server {
  return { log: [], requests: [] };
}

function createSearchMachine({ log, requests }: Server): SearchMachine {
  return defineReducerMachine<SearchState, SearchEvent, SearchInput>()({
    id: freshId('search'),
    discriminant: 'status',
    states: {
      idle: { on: { SEARCH: (_state, event) => ({ status: 'loading', query: event.query, progress: 0 }) } },
      loading: {
        on: {
          PROGRESS: (state, event) => ({ ...state, progress: event.progress }),
          RESOLVE: (state, event) => ({ status: 'ready', query: state.query, result: event.result }),
          CANCEL: () => ({ status: 'idle' }),
          FAIL: (_state, event) => ({ status: 'failed', message: event.message }),
        },
        effect: (state, send, input) => {
          log.push(`start ${state.query} with ${input().tag}`);
          requests.push({
            query: state.query,
            respond: () => {
              log.push(`respond to ${state.query} with ${input().tag}`);
              send({ type: 'RESOLVE', result: `result for ${state.query}` });
            },
          });

          return () => {
            log.push(`cleanup ${state.query}`);
          };
        },
      },
      ready: { on: { SEARCH: (_state, event) => ({ status: 'loading', query: event.query, progress: 0 }) } },
      failed: {},
    },
  });
}

function Search({ machine, name = 'search', tag = 't1' }: { machine: SearchMachine; name?: string; tag?: string }) {
  const [state, dispatch] = useMachineReducer(machine, IDLE, { input: { tag } });

  return (
    <>
      <output aria-label={name}>{JSON.stringify(state)}</output>
      <button type="button" onClick={() => dispatch({ type: 'SEARCH', query: 'a' })}>
        {name}: search a
      </button>
      <button type="button" onClick={() => dispatch({ type: 'SEARCH', query: 'b' })}>
        {name}: search b
      </button>
      <button type="button" onClick={() => dispatch({ type: 'PROGRESS', progress: 50 })}>
        {name}: progress
      </button>
      <button type="button" onClick={() => dispatch({ type: 'CANCEL' })}>
        {name}: cancel
      </button>
      <button
        type="button"
        onClick={() => {
          dispatch({ type: 'CANCEL' });
          dispatch({ type: 'SEARCH', query: 'b' });
        }}
      >
        {name}: cancel and search b
      </button>
      <button
        type="button"
        onClick={() => {
          dispatch({ type: 'SEARCH', query: 'a' });
          dispatch({ type: 'FAIL', message: 'at once' });
        }}
      >
        {name}: search a and fail
      </button>
    </>
  );
}

function shown(name = 'search'): SearchState {
  return JSON.parse(screen.getByRole('status', { name }).textContent ?? 'null');
}

async function respond(request: SearchRequest | undefined): Promise<void> {
  if (request === undefined) throw new Error('The effect of loading started no such request.');
  await act(async () => request.respond());
}

test('a machine renders each state that it enters, and the effect of a state starts on entry and cleans up on exit', async () => {
  const server = createServer();
  render(<Search machine={createSearchMachine(server)} />);
  const mounted = shown();
  await press('search: search a');
  const entered = { shown: shown(), log: [...server.log] };
  await respond(server.requests[0]);

  expect({ mounted, entered, left: { shown: shown(), log: server.log } }).toEqual({
    mounted: { status: 'idle' },
    entered: { shown: { status: 'loading', query: 'a', progress: 0 }, log: ['start a with t1'] },
    left: {
      shown: { status: 'ready', query: 'a', result: 'result for a' },
      log: ['start a with t1', 'respond to a with t1', 'cleanup a'],
    },
  });
});

test('two instances of one machine run apart', async () => {
  const server = createServer();
  const machine = createSearchMachine(server);
  render(
    <>
      <Search machine={machine} name="first" />
      <Search machine={machine} name="second" />
    </>,
  );
  await press('second: search b');
  await press('first: search a');
  await respond(server.requests[0]);

  expect({ first: shown('first'), second: shown('second') }).toEqual({
    first: { status: 'loading', query: 'a', progress: 0 },
    second: { status: 'ready', query: 'b', result: 'result for b' },
  });
});

describe('the reducer of a machine', () => {
  type DoorState = { status: 'closed' } | { status: 'open' };

  type DoorEvent = { type: 'open' } | { type: 'close' };


  const door = defineReducerMachine<DoorState, DoorEvent>()({
    id: freshId('door'),
    discriminant: 'status',
    states: {
      closed: { on: { open: () => ({ status: 'open' }) } },
      open: { on: { close: () => ({ status: 'closed' }) } },
    },
  });

  const closed: DoorState = { status: 'closed' };

  test('returns the next state for an event that the state handles', () => {
    expect(door.reducer(closed, { type: 'open' })).toEqual({ status: 'open' });
  });

  test('returns the same object for an event that the state ignores', () => {
    expect(door.reducer(closed, { type: 'close' })).toBe(closed);
  });

  // The types reject these values, so they come from JSON, as a message from a server or a stored state does.
  test.each(['constructor', 'toString'])('returns the same object for an event with the inherited name %s', (type) => {
    const event: DoorEvent = JSON.parse(JSON.stringify({ type }));

    expect(door.reducer(closed, event) === closed).toBe(true);
  });

  test.each(['constructor', 'locked'])('returns the same object for a state with the undeclared name %s', (status) => {
    const stored: DoorState = JSON.parse(JSON.stringify({ status }));

    expect(door.reducer(stored, { type: 'open' }) === stored).toBe(true);
  });

  // jsdom calls Object.hasOwn, so the test puts it back before it reads the DOM or compares a value.
  test('runs a transition in a browser that has no Object.hasOwn', () => {
    const hasOwn = Object.getOwnPropertyDescriptor(Object, 'hasOwn');

    if (hasOwn === undefined) throw new Error('This runtime has no Object.hasOwn to remove.');
    Reflect.deleteProperty(Object, 'hasOwn');
    let seen;

    try {
      seen = { hasOwn: 'hasOwn' in Object, next: door.reducer(closed, { type: 'open' }) };
    } finally {
      Object.defineProperty(Object, 'hasOwn', hasOwn);
    }

    expect(seen).toEqual({ hasOwn: false, next: { status: 'open' } });
  });
});

describe('the effect of a state', () => {
  test('keeps running through a transition that keeps the state name', async () => {
    const server = createServer();
    render(<Search machine={createSearchMachine(server)} />);
    await press('search: search a');
    await press('search: progress');
    const kept = { shown: shown(), log: [...server.log] };
    await respond(server.requests[0]);

    expect({ kept, requests: server.requests.length, shown: shown() }).toEqual({
      kept: { shown: { status: 'loading', query: 'a', progress: 50 }, log: ['start a with t1'] },
      requests: 1,
      shown: { status: 'ready', query: 'a', result: 'result for a' },
    });
  });

  test('changes nothing with an event that it sends after its state is left', async () => {
    const server = createServer();
    render(<Search machine={createSearchMachine(server)} />);
    await press('search: search a');
    await press('search: cancel');
    await press('search: search b');
    await respond(server.requests[0]);

    expect({ shown: shown(), log: server.log }).toEqual({
      shown: { status: 'loading', query: 'b', progress: 0 },
      log: ['start a with t1', 'cleanup a', 'start b with t1', 'respond to a with t1'],
    });
  });

  test('starts again after a batch of events that leaves its state and enters it again', async () => {
    const server = createServer();
    render(<Search machine={createSearchMachine(server)} />);
    await press('search: search a');
    await press('search: cancel and search b');
    const entered = [...server.log];
    await respond(server.requests.at(-1));

    expect({ entered, shown: shown() }).toEqual({
      entered: ['start a with t1', 'cleanup a', 'start b with t1'],
      shown: { status: 'ready', query: 'b', result: 'result for b' },
    });
  });

  test('never starts for a state that one batch of events enters and leaves', async () => {
    const server = createServer();
    render(<Search machine={createSearchMachine(server)} />);
    await press('search: search a and fail');

    expect({ shown: shown(), log: server.log }).toEqual({ shown: { status: 'failed', message: 'at once' }, log: [] });
  });

  test('reads the newest input, and a new input does not start it again', async () => {
    const server = createServer();
    const machine = createSearchMachine(server);
    const view = render(<Search machine={machine} tag="t1" />);
    await press('search: search a');
    view.rerender(<Search machine={machine} tag="t2" />);
    view.rerender(<Search machine={machine} tag="t3" />);
    await respond(server.requests[0]);

    expect(server.log).toEqual(['start a with t1', 'respond to a with t3', 'cleanup a']);
  });
});

describe('a lazy initial state', () => {
  test.each([
    { reactStrictMode: false, runs: 1 },
    { reactStrictMode: true, runs: 2 },
  ])('runs as often as the initializer of useReducer, with StrictMode $reactStrictMode', async ({ reactStrictMode, runs }) => {
    const machine = createSearchMachine(createServer());
    const counts = { hook: 0, react: 0 };

    function Both() {
      const [renders, renderAgain] = useReducer((count: number) => count + 1, 0);

      const [state] = useMachineReducer(
        machine,
        () => {
          counts.hook += 1;

          return IDLE;
        },
        { input: { tag: 't1' } },
      );

      useReducer(
        (current: SearchState) => current,
        undefined,
        () => {
          counts.react += 1;

          return IDLE;
        },
      );

      return (
        <button type="button" onClick={renderAgain}>
          {state.status} {renders}
        </button>
      );
    }

    render(<Both />, { reactStrictMode });
    await press('idle 0');
    await press('idle 1');

    expect({ counts, shown: screen.getByRole('button').textContent }).toEqual({
      counts: { hook: runs, react: runs },
      shown: 'idle 2',
    });
  });
});
