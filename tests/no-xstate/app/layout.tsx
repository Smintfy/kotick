import type { ReactNode } from 'react';
import { Kotick } from 'kotick';

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
