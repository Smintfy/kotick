import { useState } from 'react';
import { useMachineReducer } from 'konat/reducer';
import { formatPrice } from '@/lib/format.ts';
import { useRenderStats } from '@/lib/renderStats.ts';
import { searchProducts } from '@/lib/searchProducts.ts';
import { searchMachine, type SearchEvent, type SearchState } from '@/machines/search.ts';

export function ProductSearch() {
  const [text, setText] = useState('');
  const [offline, setOffline] = useState(false);
  const stats = useRenderStats('search');

  // The input is a new object on each render.
  // The effect reads the newest one through input(), so a render does not restart it.
  const [state, dispatch] = useMachineReducer(
    searchMachine,
    { status: 'idle' },
    { input: { search: (query, signal) => searchProducts(query, signal, offline) } },
  );

  return (
    <section className="card" aria-label="Search">
      <small ref={stats} className="stats" />

      <form
        className="actions"
        onSubmit={(event) => {
          event.preventDefault();
          dispatch({ type: 'SEARCH', query: text });
        }}
      >
        <input value={text} placeholder="mug" aria-label="Product name" onChange={(event) => setText(event.target.value)} />
        <button type="submit">Search</button>
      </form>

      <label className="option">
        <input type="checkbox" checked={offline} onChange={(event) => setOffline(event.target.checked)} />
        Lose the connection
      </label>
      <p className="muted">A search takes 600 ms. While it runs, the loading state ignores a second search.</p>

      <SearchResult state={state} dispatch={dispatch} />
    </section>
  );
}

function SearchResult({ state, dispatch }: { state: SearchState; dispatch: (event: SearchEvent) => void }) {
  switch (state.status) {
    case 'idle':
      return <p className="muted">Search the products by name.</p>;
    case 'loading':
      return (
        <div className="actions">
          <span role="status">Searching for “{state.query}”…</span>
          <button type="button" onClick={() => dispatch({ type: 'CANCEL' })}>
            Cancel
          </button>
        </div>
      );
    case 'ready':
      if (state.hits.length === 0) return <p className="muted">No product matches “{state.query}”.</p>;

      return (
        <ul className="lines">
          {state.hits.map((product) => (
            <li key={product.id}>
              <span>{product.name}</span>
              <span className="muted">{formatPrice(product.priceCents)}</span>
            </li>
          ))}
        </ul>
      );
    case 'failed':
      return (
        <div role="alert" className="notice notice-error">
          <p>{state.error}</p>
          <div className="actions">
            <button type="button" onClick={() => dispatch({ type: 'SEARCH', query: state.query })}>
              Try again
            </button>
          </div>
        </div>
      );
  }
}
