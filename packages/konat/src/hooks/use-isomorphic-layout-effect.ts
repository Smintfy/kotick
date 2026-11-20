import { useEffect, useLayoutEffect } from 'react';

// Layout effects don't run on the server, and React 18 warns when they're used there.
export const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
