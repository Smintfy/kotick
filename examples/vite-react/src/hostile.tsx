// The demo under global styles that try to reach the overlay (spec §12: hostile global CSS doesn't change the panel,
// and the panel doesn't change the app). Served at /hostile.html by the dev server.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './hostile.css';
import { App } from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
