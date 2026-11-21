import { NavLink, Outlet } from 'react-router';
import { Konat } from 'konat';
import { SessionStatus } from '@/components/SessionStatus.tsx';
import { examples } from '@/examples.ts';

// The DEV condition on the loader removes the fixtures chunk from production builds.
const fixtures = import.meta.env.DEV ? () => import('@/debug/fixtures.ts') : undefined;

export function Layout() {
  return (
    <>
      <header className="app-header">
        <nav className="nav" aria-label="Examples">
          <NavLink to="/" end>
            konat
          </NavLink>
          {Object.values(examples).map((example) => (
            <NavLink key={example.path} to={example.path}>
              {example.title}
            </NavLink>
          ))}
        </nav>
        <SessionStatus />
      </header>

      <main className="page">
        <Outlet />
      </main>

      {/* The overlay is in the layout.
          Thus, it stays mounted while the pages change and their machines register and unregister. */}
      <Konat fixtures={fixtures} />
    </>
  );
}
