import { createRoot } from 'react-dom/client';
import { Konat } from 'konat';
import { ReducerDemo } from './reducer-demo';

// The condition removes the fixtures chunk from production builds, as in src/main.tsx.
const fixtures = process.env.NODE_ENV !== 'production' ? () => import('./fixtures') : undefined;

createRoot(document.getElementById('root')!).render(
  <>
    <ReducerDemo />
    <Konat fixtures={fixtures} />
  </>,
);
