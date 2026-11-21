// An error boundary for tests that also run on React 18, whose render() has no onCaughtError.

import { screen } from '@testing-library/react';
import * as React from 'react';
import { errorMessage } from './console';

type Caught = { message: string | null };

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

export function alerts(): (string | null)[] {
  return screen.queryAllByRole('alert').map((alert) => alert.textContent);
}
