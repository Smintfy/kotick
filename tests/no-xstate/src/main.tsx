import { createRoot } from 'react-dom/client';
import { Shiru } from 'shiru';
import { Door } from './door';

createRoot(document.getElementById('root')!).render(
  <>
    <Door delay={500} />
    <Shiru />
  </>,
);
