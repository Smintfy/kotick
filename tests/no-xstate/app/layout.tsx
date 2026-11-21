import type { ReactNode } from 'react';
import { Konat } from 'konat';

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
