import * as React from 'react';
import { useIsomorphicLayoutEffect } from './use-isomorphic-layout-effect';

/** The value from the latest commit, for listeners set up once. */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = React.useRef(value);
  useIsomorphicLayoutEffect(() => {
    ref.current = value;
  });

  return ref;
}
