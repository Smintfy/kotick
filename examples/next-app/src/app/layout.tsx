import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DevTools } from '@/components/DevTools';
import { Nav } from '@/components/Nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'state-viewer · Next.js',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="app-header">
          <strong>state-viewer</strong>
          <Nav />
        </header>
        <main className="page">{children}</main>
        {/* The overlay is in the root layout.
            Thus, it stays mounted while the pages change and their machines register and unregister. */}
        <DevTools />
      </body>
    </html>
  );
}
