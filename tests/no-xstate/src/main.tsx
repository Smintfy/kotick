import { createRoot } from 'react-dom/client';
import { Kotick } from 'kotick';
import { Door } from './door';

createRoot(document.getElementById('root')!).render(
  <>
    <Door delay={500} />
    <Kotick />
  </>,
);
