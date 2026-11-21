'use client';

import { Fragment, useSyncExternalStore } from 'react';
import { Kbd } from '@/components/ui/kbd';

const noChange = () => () => {};

function detectApple(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

export function useIsApple(): boolean {
  return useSyncExternalStore(noChange, detectApple, () => false);
}

export function Shortcut({ mac, other }: { mac: string; other: string[] }) {
  if (useIsApple()) return <Kbd>{mac}</Kbd>;

  return other.map((key, index) => (
    <Fragment key={key}>
      {index > 0 && '+'}
      <Kbd>{key}</Kbd>
    </Fragment>
  ));
}
