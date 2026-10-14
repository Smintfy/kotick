import { StateViewer } from 'state-viewer';
import { Cart } from './cart/Cart.tsx';
import { Checkout } from './checkout/Checkout.tsx';
import { SessionStatus } from './session/SessionStatus.tsx';
import { Uploads } from './uploads/Uploads.tsx';

export function App() {
  return (
    <>
      <header className="app-header">
        <div>
          <h1>state-viewer · vite-react</h1>
          <p className="muted">
            Each section reads XState state a different way. The counters show mounts and committed renders; a preview
            should never add a mount.
          </p>
        </div>
        <SessionStatus />
      </header>

      <main className="grid">
        <Checkout />
        <Cart />
        <Uploads />
      </main>

      <StateViewer />
    </>
  );
}
