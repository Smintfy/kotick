// Renders the components under test next to the overlay, and uses them as a user does.

import { fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { StateViewer } from 'state-viewer';
import { flush } from './panel';

/** The app next to an open overlay, for render() and rerender(). */
export function page(app: ReactNode) {
  return (
    <>
      {app}
      <StateViewer defaultOpen />
    </>
  );
}

/** Clicks the app's button with this name, and waits for React to render. */
export async function press(name: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name }));
  await flush();
}
