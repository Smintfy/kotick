import { formatPrice } from '../format.ts';
import { products } from '../products.ts';
import { useRenderStats } from '../renderStats.ts';
import { CartContext } from './CartContext.ts';

export function Cart() {
  const stats = useRenderStats('cart');

  return (
    <CartContext.Provider>
      <section className="card" aria-labelledby="cart-title">
        <header className="card-header">
          <div>
            <h2 id="cart-title">Cart</h2>
            <p className="pattern">
              <code>createActorContext</code> · read with <code>useSelector</code>
            </p>
          </div>
          <small ref={stats} className="stats" />
        </header>
        <CartBadge />
        <Catalog />
        <CartLines />
      </section>
    </CartContext.Provider>
  );
}

function CartBadge() {
  const count = CartContext.useSelector((snapshot) => snapshot.context.items.reduce((sum, item) => sum + item.qty, 0));
  const stats = useRenderStats('cart-badge');

  return (
    <p className="row">
      <span>
        Items in cart: <strong data-testid="cart-count">{count}</strong>
      </span>
      <small ref={stats} className="stats" />
    </p>
  );
}

// Only sends events, so it should never re-render after mounting.
function Catalog() {
  const cart = CartContext.useActorRef();
  const stats = useRenderStats('cart-catalog');

  return (
    <div className="stack">
      <ul className="lines">
        {products.map((product) => (
          <li key={product.id}>
            <span>
              {product.name} <span className="muted">{formatPrice(product.price)}</span>
            </span>
            <button type="button" aria-label={`Add ${product.name}`} onClick={() => cart.send({ type: 'ADD', product })}>
              Add
            </button>
          </li>
        ))}
      </ul>
      <small ref={stats} className="stats" />
    </div>
  );
}

function CartLines() {
  const cart = CartContext.useActorRef();
  const isEmpty = CartContext.useSelector((snapshot) => snapshot.matches('empty'));
  const items = CartContext.useSelector((snapshot) => snapshot.context.items);
  const stats = useRenderStats('cart-lines');
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);

  return (
    <div className="stack">
      {isEmpty ? (
        <p className="muted">Your cart is empty.</p>
      ) : (
        <>
          <ul className="lines">
            {items.map((item) => (
              <li key={item.id}>
                <span>
                  {item.name} × {item.qty}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${item.name}`}
                  onClick={() => cart.send({ type: 'REMOVE', id: item.id })}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <p className="total">
            <span>Subtotal</span>
            <strong>{formatPrice(subtotal)}</strong>
          </p>
          <button type="button" onClick={() => cart.send({ type: 'CLEAR' })}>
            Clear cart
          </button>
        </>
      )}
      <small ref={stats} className="stats" />
    </div>
  );
}
