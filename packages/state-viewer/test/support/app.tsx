// Renders the components under test next to the overlay, and uses them as a user does.

import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { StateViewer, type StateViewerProps } from 'state-viewer';
import { onTestFinished } from 'vitest';
import { createActor, type Actor, type AnyStateMachine } from 'xstate';
import { flush } from './panel';

/** The app next to an open overlay, for render() and rerender(). */
export function page(app: ReactNode, props?: StateViewerProps) {
  return (
    <>
      {app}
      <StateViewer defaultOpen {...props} />
    </>
  );
}

/** Renders the app next to an open overlay, and waits for the overlay to list its machines. */
export async function mount(app: ReactNode, props?: StateViewerProps) {
  const view = render(page(app, props));
  await flush();

  return view;
}

/** Starts an actor outside React, as a module that owns it does. The actor stops when the test ends. */
export function start<TMachine extends AnyStateMachine>(machine: TMachine): Actor<TMachine> {
  const actor = createActor(machine).start();
  onTestFinished(() => {
    actor.stop();
  });

  return actor;
}

/** Clicks the app's button with this name, and waits for React to render. */
export async function press(name: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name }));
  await flush();
}
