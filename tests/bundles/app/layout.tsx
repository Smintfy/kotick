import type { ReactNode } from 'react';
import { Konat } from 'konat';

// A server component renders <Konat /> directly: the 'use client' at the top of the package entry allows it.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Konat />
      </body>
    </html>
  );
}
