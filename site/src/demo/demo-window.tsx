'use client';

import { RotateCcw, SquareArrowOutUpRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { type FixturesInput, Konat } from 'konat';
import { useIsApple } from '@/components/shortcut';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * A frame for a demo app, with the real overlay docked in it. Reset mounts the app again.
 * `href` is the full-window page of the demo. It opens in a new tab.
 */
export function DemoWindow({ fixtures, href, children }: { fixtures: FixturesInput; href: string; children: ReactNode }) {
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const [run, setRun] = useState(0);
  const toggleKeys = useIsApple() ? '⌥S' : 'Alt+S';

  return (
    <figure className="not-prose relative mb-6 rounded-2xl shadow-code">
      <div className="absolute top-3 right-3 z-10 flex gap-1 text-muted-foreground">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open in a new tab"
                nativeButton={false}
                render={<a href={href} target="_blank" rel="noreferrer" />}
              />
            }
          >
            <SquareArrowOutUpRight />
          </TooltipTrigger>
          <TooltipContent>Open in a new tab</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label="Reset" onClick={() => setRun(run + 1)} />}>
            <RotateCcw />
          </TooltipTrigger>
          <TooltipContent>Reset</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex min-h-[520px] flex-col px-6 pt-14 pb-20">
        <div key={run} className="mx-auto flex w-full max-w-[360px] flex-1 flex-col">
          {children}
        </div>
      </div>
      {/*
       * The host of the overlay is position: fixed.
       * With contain: layout, the dock is the containing block of the host, so the overlay stays in the dock.
       * The dock starts below the buttons, so the open panel does not cover them.
       */}
      <div ref={setDock} className="pointer-events-none absolute inset-x-0 top-14 bottom-0 [contain:layout]">
        <p className="absolute right-16 bottom-8 m-0 translate-y-1/2 text-[13px] text-muted-foreground">Click the bubble, or press {toggleKeys}.</p>
        {dock && <Konat portalTarget={dock} fixtures={fixtures} />}
      </div>
    </figure>
  );
}
