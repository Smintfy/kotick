import type { ReactNode } from 'react';
import { Shiru } from 'shiru';

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
