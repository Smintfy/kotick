'use client';

import { Fragment, useSyncExternalStore } from 'react';
import { Kbd } from '@/components/ui/kbd';

const noChange = () => () => {};

/** The same test as the overlay's: some browsers give an empty platform, and the user agent also names the system. */
function detectApple(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

/** `false` on the server and during hydration, so the first render matches the HTML. */
export function useIsApple(): boolean {
  return useSyncExternalStore(noChange, detectApple, () => false);
}

/**
 * The keys of a shortcut as the reader's system writes them.
 * On macOS, one key cap holds the symbols, such as ⌥S, as in the overlay. On other systems, a + joins the keys, such as Alt+S.
 */
export function Shortcut({ mac, other }: { mac: string; other: string[] }) {
  if (useIsApple()) return <Kbd>{mac}</Kbd>;

  return other.map((key, index) => (
    <Fragment key={key}>
      {index > 0 && '+'}
      <Kbd>{key}</Kbd>
    </Fragment>
  ));
}
