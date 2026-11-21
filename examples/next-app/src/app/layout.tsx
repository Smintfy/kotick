import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DevTools } from '@/components/dev-tools';
import { Nav } from '@/components/nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'kotick · Next.js',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="app-header">
          <strong>kotick</strong>
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
