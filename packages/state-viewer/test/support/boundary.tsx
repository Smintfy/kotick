// An error boundary for tests that also run on React 18, whose render() has no onCaughtError.

import { screen } from '@testing-library/react';
import * as React from 'react';

/** Shows the message of the error that it caught, as an alert. */
export class Boundary extends React.Component<{ children: React.ReactNode }, { error: unknown }> {
  override state: { error: unknown } = { error: undefined };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override render() {
    if (this.state.error === undefined) return this.props.children;

    return <p role="alert">{this.state.error instanceof Error ? this.state.error.message : String(this.state.error)}</p>;
  }
}

/** The text of each alert on the page, which is what each Boundary caught. */
export function alerts(): (string | null)[] {
  return screen.queryAllByRole('alert').map((alert) => alert.textContent);
}
