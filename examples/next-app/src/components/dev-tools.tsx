'use client';

import { Konat } from 'konat';

// A server component can render <Konat /> too, but it can't give it the fixtures loader, which is a function.
// Thus, this client component gives the loader.
// The condition removes the fixtures chunk from production builds.
const fixtures = process.env.NODE_ENV !== 'production' ? () => import('@/debug/fixtures') : undefined;

export function DevTools() {
  return <Konat fixtures={fixtures} />;
}
