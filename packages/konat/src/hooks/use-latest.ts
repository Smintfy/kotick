import { useRef } from 'react';
import { useIsomorphicLayoutEffect } from '../shared-hooks/use-isomorphic-layout-effect';

export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useIsomorphicLayoutEffect(() => {
    ref.current = value;
  });

  return ref;
}
