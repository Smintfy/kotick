// An error boundary for tests that also run on React 18, whose render() has no onCaughtError.

import { screen } from '@testing-library/react';
import * as React from 'react';
import { errorMessage } from './console';

/** The message of the error that the boundary caught, or null before it catches one. */
type Caught = { message: string | null };

/** Shows the message of the error that it caught, as an alert. */
export class Boundary extends React.Component<{ children: React.ReactNode }, Caught> {
  override state: Caught = { message: null };

  static getDerivedStateFromError(cause: unknown): Caught {
    return { message: errorMessage(cause) };
  }

  override render() {
    if (this.state.message === null) return this.props.children;

    return <p role="alert">{this.state.message}</p>;
  }
}

/** The text of each alert on the page, which is what each Boundary caught. */
export function alerts(): (string | null)[] {
  return screen.queryAllByRole('alert').map((alert) => alert.textContent);
}
