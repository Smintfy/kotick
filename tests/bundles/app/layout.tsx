import type { ReactNode } from 'react';
import { Shiru } from 'shiru';

// A server component renders <Shiru /> directly: the 'use client' at the top of the package entry allows it.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Shiru />
      </body>
    </html>
  );
}
