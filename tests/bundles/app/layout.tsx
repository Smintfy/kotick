import type { ReactNode } from 'react';
import { Kotick } from 'kotick';

// A server component renders <Kotick /> directly: the 'use client' at the top of the package entry allows it.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Kotick />
      </body>
    </html>
  );
}
