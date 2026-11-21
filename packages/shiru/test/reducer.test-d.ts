// Vitest typechecks this file but never runs it.
// So the tests call the hook outside components.
// Each @ts-expect-error marks one mistake that the types reject.

import { Shiru } from 'shiru';
import { defineFixtures, defineReducerMachine, useMachineReducer, type CompleteFixtures } from 'shiru/reducer';
import { describe, expectTypeOf, test } from 'vitest';

type UploadState =
  | { status: 'queued'; fileName: string }
  | { status: 'uploading'; fileName: string; progress: number }
  | { status: 'failed'; fileName: string; error: string }
  | { status: 'done'; fileName: string };

type UploadEvent =
  | { type: 'START' }
  | { type: 'PROGRESS'; progress: number }
  | { type: 'FAIL'; error: string }
  | { type: 'COMPLETE' }
  | { type: 'RETRY' }
  | { type: 'CANCEL' };

const define = defineReducerMachine<UploadState, UploadEvent>();

const uploadMachine = define({
  id: 'upload',
  discriminant: 'status',
  states: {
    queued: { on: { START: (state) => ({ status: 'uploading', fileName: state.fileName, progress: 0 }) } },
    uploading: {
      on: {
        PROGRESS: (state, event) => ({ ...state, progress: event.progress }),
        FAIL: (state, event) => {
          expectTypeOf(state).toEqualTypeOf<{ status: 'uploading'; fileName: string; progress: number }>();
          expectTypeOf(event).toEqualTypeOf<{ type: 'FAIL'; error: string }>();

          return { status: 'failed', fileName: state.fileName, error: event.error };
        },
        COMPLETE: (state) => ({ status: 'done', fileName: state.fileName }),
        CANCEL: (state) => ({ status: 'queued', fileName: state.fileName }),
      },
      effect: (state, send, input) => {
        expectTypeOf(state).toEqualTypeOf<{ status: 'uploading'; fileName: string; progress: number }>();
        expectTypeOf(send).toEqualTypeOf<(event: UploadEvent) => void>();
        expectTypeOf(input).toEqualTypeOf<() => undefined>();
        const timer = setTimeout(() => send({ type: 'COMPLETE' }), 1000);

        return () => clearTimeout(timer);
      },
    },
    failed: { on: { RETRY: (state) => ({ status: 'uploading', fileName: state.fileName, progress: 0 }) } },
    done: {},
  },
});

const queued: UploadState = { status: 'queued', fileName: 'report.pdf' };

type DraftState =
  | { status: 'editing'; draft: string }
  | { status: 'saving' | 'deleting'; draft: string; startedAt: number };

type DraftEvent = { type: 'SAVE' } | { type: 'DELETE' } | { type: 'DONE' };

type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'ready'; query: string; hits: string[] };

type SearchEvent = { type: 'SEARCH'; query: string } | { type: 'RESOLVE'; hits: string[] } | { type: 'CANCEL' };

interface SearchInput {
  search(query: string, signal: AbortSignal): Promise<string[]>;
  onHits(hits: string[]): void;
}

declare const search: SearchInput['search'];
declare const onHits: SearchInput['onHits'];

const searchMachine = defineReducerMachine<SearchState, SearchEvent, SearchInput>()({
  id: 'search',
  discriminant: 'status',
  states: {
    idle: { on: { SEARCH: (_state, event) => ({ status: 'loading', query: event.query }) } },
    loading: {
      on: {
        RESOLVE: (state, event) => ({ status: 'ready', query: state.query, hits: event.hits }),
        CANCEL: () => ({ status: 'idle' }),
      },
      effect: (state, send, input) => {
        expectTypeOf(input).toEqualTypeOf<() => SearchInput>();
        const controller = new AbortController();
        void input()
          .search(state.query, controller.signal)
          .then((hits) => {
            send({ type: 'RESOLVE', hits });
            input().onHits(hits);
          });

        return () => controller.abort();
      },
    },
    ready: { on: { SEARCH: (_state, event) => ({ status: 'loading', query: event.query }) } },
  },
});

describe('defineReducerMachine', () => {
  test('the machine has the state names of the union, and its reducer keeps the union', () => {
    expectTypeOf<keyof typeof uploadMachine.states>().toEqualTypeOf<'queued' | 'uploading' | 'failed' | 'done'>();
    expectTypeOf(uploadMachine.reducer(queued, { type: 'START' })).toEqualTypeOf<UploadState>();
  });

  test('a member whose discriminant is a union belongs to each of its states', () => {
    defineReducerMachine<DraftState, DraftEvent>()({
      id: 'draft',
      discriminant: 'status',
      states: {
        editing: {
          on: {
            SAVE: (state) => ({ status: 'saving', draft: state.draft, startedAt: 0 }),
            DELETE: (state) => ({ status: 'deleting', draft: state.draft, startedAt: 0 }),
          },
        },
        saving: {
          on: {
            DONE: (state) => {
              expectTypeOf(state.status).toEqualTypeOf<'saving'>();

              return { status: 'editing', draft: state.draft };
            },
          },
        },
        deleting: { on: { DONE: () => ({ status: 'editing', draft: '' }) } },
      },
    });
  });

  test('the states are exhaustive', () => {
    // @ts-expect-error the union has the state `done`, so the definition must declare it
    define({ id: 'm', discriminant: 'status', states: { queued: {}, uploading: {}, failed: {} } });
    // @ts-expect-error `paused` isn't a state of the union
    define({ id: 'm', discriminant: 'status', states: { queued: {}, uploading: {}, failed: {}, done: {}, paused: {} } });
  });

  test('the discriminant is a key with a finite set of names in every member', () => {
    // @ts-expect-error `fileName` holds plain strings, so it names no finite set of states
    define({ id: 'm', discriminant: 'fileName', states: {} });
    // @ts-expect-error `progress` isn't a key of every member
    define({ id: 'm', discriminant: 'progress', states: {} });
  });

  test('a handler sees the member of its state and the event of its type', () => {
    define({
      id: 'm',
      discriminant: 'status',
      states: {
        // @ts-expect-error `STRAT` isn't an event type
        queued: { on: { STRAT: (state) => state } },
        // @ts-expect-error the COMPLETE event has no `progress`
        uploading: { on: { COMPLETE: (state, event) => ({ ...state, progress: event.progress }) } },
        // @ts-expect-error the failed state has no `progress`
        failed: { on: { RETRY: (state) => ({ status: 'uploading', fileName: state.fileName, progress: state.progress }) } },
        done: {},
      },
    });
  });

  test('a handler returns a state of the union', () => {
    define({
      id: 'm',
      discriminant: 'status',
      states: {
        // @ts-expect-error `paused` isn't a state
        queued: { on: { START: (state) => ({ status: 'paused', fileName: state.fileName }) } },
        // @ts-expect-error the uploading state needs `progress`
        failed: { on: { RETRY: (state) => ({ status: 'uploading', fileName: state.fileName }) } },
        uploading: {},
        done: {},
      },
    });
  });

  test('an effect sends the events of the machine, and returns nothing or a cleanup function', () => {
    define({
      id: 'm',
      discriminant: 'status',
      states: {
        queued: {},
        // @ts-expect-error `PAUSE` isn't an event type
        uploading: { effect: (_state, send) => send({ type: 'PAUSE' }) },
        // @ts-expect-error an effect returns nothing or a cleanup function, so it can't be async
        failed: { effect: async () => {} },
        done: {},
      },
    });
  });

  test('a transition takes no input, and an effect reads the input type of its machine', () => {
    defineReducerMachine<SearchState, SearchEvent, SearchInput>()({
      id: 'm',
      discriminant: 'status',
      states: {
        // @ts-expect-error a transition gets no input, because it must be pure
        idle: { on: { SEARCH: (_state, event, input: () => SearchInput) => ({ status: 'loading', query: input() && event.query }) } },
        // @ts-expect-error the input has no `navigate`
        loading: { effect: (_state, _send, input) => input().navigate('/') },
        ready: {},
      },
    });
  });
});

describe('useMachineReducer', () => {
  test('the hook returns the union and a dispatch for the events of the machine', () => {
    expectTypeOf(useMachineReducer(uploadMachine, queued)).toEqualTypeOf<[UploadState, (event: UploadEvent) => void]>();
    expectTypeOf(useMachineReducer(uploadMachine, () => queued, { debug: { label: 'report.pdf', disabled: false } })).toEqualTypeOf<
      [UploadState, (event: UploadEvent) => void]
    >();
    expectTypeOf(useMachineReducer(searchMachine, { status: 'idle' }, { input: { search, onHits } })).toEqualTypeOf<
      [SearchState, (event: SearchEvent) => void]
    >();
  });

  test('dispatch takes the events of the machine', () => {
    const [, dispatch] = useMachineReducer(uploadMachine, queued);
    // @ts-expect-error `STRAT` isn't an event type
    dispatch({ type: 'STRAT' });
    // @ts-expect-error the FAIL event needs `error`
    dispatch({ type: 'FAIL' });
  });

  test('the initial state is a state of the union, and the machine sets the types', () => {
    // @ts-expect-error `paused` isn't a state
    useMachineReducer(uploadMachine, { status: 'paused', fileName: 'a.pdf' });
    // @ts-expect-error the uploading state needs `progress`
    useMachineReducer(uploadMachine, () => ({ status: 'uploading', fileName: 'a.pdf' }));
    // @ts-expect-error the initial state is required, as for useReducer
    useMachineReducer(uploadMachine);
    // @ts-expect-error the hook takes a machine, not its reducer
    useMachineReducer(uploadMachine.reducer, queued);
  });

  test('the hook requires the input when the machine declares its type, and takes none when it declares none', () => {
    // @ts-expect-error the machine declares an input, so the hook needs the options
    useMachineReducer(searchMachine, { status: 'idle' });
    // @ts-expect-error the machine declares an input, so the options need `input`
    useMachineReducer(searchMachine, { status: 'idle' }, { debug: { label: 'search' } });
    // @ts-expect-error the input lacks `onHits`
    useMachineReducer(searchMachine, { status: 'idle' }, { input: { search } });
    // @ts-expect-error the upload machine declares no input
    useMachineReducer(uploadMachine, queued, { input: { search, onHits } });
  });
});

describe('defineFixtures', () => {
  const fixtures = {
    queued: { status: 'queued', fileName: 'a.pdf' },
    uploading: { status: 'uploading', fileName: 'a.pdf', progress: 1 },
    failed: { status: 'failed', fileName: 'a.pdf', error: 'e' },
    done: { status: 'done', fileName: 'a.pdf' },
  } as const;

  test('a set can list any of the states, CompleteFixtures asks for all of them, and <Shiru fixtures> takes the set', () => {
    Shiru({
      fixtures: [
        defineFixtures(uploadMachine, { failed: fixtures.failed }),
        defineFixtures(uploadMachine, fixtures satisfies CompleteFixtures<typeof uploadMachine>),
      ],
    });
    const { done: _done, ...withoutDone } = fixtures;

    // @ts-expect-error the complete type needs every state, and `done` has none
    defineFixtures(uploadMachine, withoutDone satisfies CompleteFixtures<typeof uploadMachine>);
  });

  test('a fixture is a whole state of its own name', () => {
    // @ts-expect-error the fixture of `uploading` must be in the uploading state
    defineFixtures(uploadMachine, { ...fixtures, uploading: { status: 'done', fileName: 'a.pdf' } });
    // @ts-expect-error the failed state needs `error`
    defineFixtures(uploadMachine, { ...fixtures, failed: { status: 'failed', fileName: 'a.pdf' } });
    // @ts-expect-error the done state has no `progress`
    defineFixtures(uploadMachine, { ...fixtures, done: { status: 'done', fileName: 'a.pdf', progress: 1 } });
    // @ts-expect-error `paused` isn't a state
    defineFixtures(uploadMachine, { ...fixtures, paused: { status: 'queued', fileName: 'a.pdf' } });
  });

  test('the fixture of a member whose discriminant is a union is in the state of its own name', () => {
    const draftMachine = defineReducerMachine<DraftState, DraftEvent>()({
      id: 'draft',
      discriminant: 'status',
      states: { editing: {}, saving: {}, deleting: {} },
    });

    defineFixtures(draftMachine, {
      editing: { status: 'editing', draft: '' },
      // @ts-expect-error the member also covers `deleting`, but the fixture of `saving` must be in the saving state
      saving: { status: 'deleting', draft: '', startedAt: 0 },
      deleting: { status: 'deleting', draft: '', startedAt: 0 },
    });
  });
});
