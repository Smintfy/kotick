import { createRoot } from 'react-dom/client';
import { Konat } from 'konat';
import { Demo } from './demo';

// The condition removes the fixtures chunk from production builds.
// react-router/app/root.tsx passes the loader without it, so the check covers both.
const fixtures = process.env.NODE_ENV !== 'production' ? () => import('./fixtures') : undefined;

createRoot(document.getElementById('root')!).render(
  <>
    <Demo />
    <Konat fixtures={fixtures} />
  </>,
);
