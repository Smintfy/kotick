import { createRoot } from 'react-dom/client';
import { Konat } from 'konat';
import { Door } from './door';

createRoot(document.getElementById('root')!).render(
  <>
    <Door delay={500} />
    <Konat />
  </>,
);
