import * as React from 'react';

// Layout effects don't run on the server, and React 18 warns when they're used there.
export const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;
