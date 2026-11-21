import { defineReducerMachine } from 'kotick/reducer';
import type { Product } from '@/lib/products.ts';

export type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'ready'; query: string; hits: Product[] }
  | { status: 'failed'; query: string; error: string };

export type SearchEvent =
  | { type: 'SEARCH'; query: string }
  | { type: 'RESOLVE'; hits: Product[] }
  | { type: 'REJECT'; error: string }
  | { type: 'CANCEL' };

/** The value that the effect of `loading` reads from the component through `input()`. */
export type SearchInput = {
  search(query: string, signal: AbortSignal): Promise<Product[]>;
};

export const searchMachine = defineReducerMachine<SearchState, SearchEvent, SearchInput>()({
  id: 'search',
  discriminant: 'status',
  states: {
    idle: {
      on: { SEARCH: (_state, event) => ({ status: 'loading', query: event.query }) },
    },
    loading: {
      on: {
        RESOLVE: (state, event) => ({ status: 'ready', query: state.query, hits: event.hits }),
        REJECT: (state, event) => ({ status: 'failed', query: state.query, error: event.error }),
        CANCEL: () => ({ status: 'idle' }),
      },
      // The request runs in the machine, so a preview never blocks its result.
      effect: (state, send, input) => {
        const controller = new AbortController();

        void input()
          .search(state.query, controller.signal)
          .then(
            (hits) => send({ type: 'RESOLVE', hits }),
            (error: Error) => send({ type: 'REJECT', error: error.message }),
          );

        return () => controller.abort();
      },
    },
    ready: {
      on: { SEARCH: (_state, event) => ({ status: 'loading', query: event.query }) },
    },
    failed: {
      on: { SEARCH: (_state, event) => ({ status: 'loading', query: event.query }) },
    },
  },
});
