'use client';

import { Shiru } from 'shiru';

// A server component can render <Shiru /> too, but it can't give it the fixtures loader, which is a function.
// Thus, this client component gives the loader.
// The condition removes the fixtures chunk from production builds.
const fixtures = process.env.NODE_ENV !== 'production' ? () => import('@/debug/fixtures') : undefined;

export function DevTools() {
  return <Shiru fixtures={fixtures} />;
}
