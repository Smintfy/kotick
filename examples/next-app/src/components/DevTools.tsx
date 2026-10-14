'use client';

import { StateViewer } from 'state-viewer';

// A server component can render <StateViewer /> too, but it can't give it the fixtures loader, which is a function.
// Thus, this client component gives the loader.
// The condition removes the fixtures chunk from production builds.
const fixtures = process.env.NODE_ENV !== 'production' ? () => import('@/debug/fixtures') : undefined;

export function DevTools() {
  return <StateViewer fixtures={fixtures} />;
}
