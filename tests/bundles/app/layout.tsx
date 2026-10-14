import type { ReactNode } from 'react';
import { StateViewer } from 'state-viewer';

// A server component renders <StateViewer /> directly: the 'use client' at the top of the package entry allows it.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <StateViewer />
      </body>
    </html>
  );
}
