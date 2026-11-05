'use client';

import { RotateCcw } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { type FixturesInput, Konat } from 'konat';
import { Button } from '@/components/ui/button';

/** A frame for a demo app, with the real overlay docked in it. Reset mounts the app again. */
export function DemoWindow({ fixtures, children }: { fixtures: FixturesInput; children: ReactNode }) {
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const [run, setRun] = useState(0);

  return (
    <figure className="relative mb-6 rounded-2xl border border-line">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Reset"
        className="absolute top-3 right-3 z-10 text-muted-foreground"
        onClick={() => setRun(run + 1)}
      >
        <RotateCcw />
      </Button>
      <div className="min-h-[520px] px-6 pt-14 pb-20">
        <div key={run} className="mx-auto max-w-[360px]">
          {children}
        </div>
      </div>
      {/*
       * The host of the overlay is position: fixed.
       * With contain: layout, the dock is the containing block of the host, so the overlay stays in the dock.
       * The dock starts below the Reset button, so the open panel does not cover the button.
       */}
      <div ref={setDock} className="pointer-events-none absolute inset-x-0 top-14 bottom-0 [contain:layout]">
        <p className="absolute right-16 bottom-8 m-0 translate-y-1/2 text-[13px] text-muted-foreground">Click the bubble, or press Alt+S.</p>
        {dock && <Konat portalTarget={dock} fixtures={fixtures} />}
      </div>
    </figure>
  );
}
