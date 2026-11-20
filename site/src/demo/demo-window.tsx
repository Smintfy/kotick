'use client';

import { RotateCcw, SquareArrowOutUpRight } from 'lucide-react';
import { type ComponentProps, type ReactNode, useState } from 'react';
import { type FixturesInput, Konat } from 'konat';
import { CopyButton } from '@/components/copy-button';
import { AdapterSwitch, useAdapter } from '@/components/docs/adapter-tabs';
import { barTab } from '@/components/docs/bar-tab';
import { useIsApple } from '@/components/docs/shortcut';
import { OverlayDock } from '@/components/overlay-dock';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Adapter } from '@/content/adapters';
import type { DemoSources } from '@/demo/source';

const keepInLayout = (props: ComponentProps<'div'>) => <div {...props} hidden={false} />;

type DemoWindowProps = { apps: Record<Adapter, ReactNode>; fixtures: FixturesInput; href: string; sources: DemoSources };

export function DemoWindow({ apps, fixtures, href, sources }: DemoWindowProps) {
  const [adapter] = useAdapter();
  const source = sources[adapter];
  const [run, setRun] = useState(0);
  const [view, setView] = useState<'preview' | 'code'>('preview');
  const toggleKeys = useIsApple() ? '⌥S' : 'Alt+S';

  return (
    <Tabs value={view} onValueChange={setView} render={<figure />} className="not-prose mb-6 gap-0 rounded-2xl shadow-code">
      <div className="flex items-center gap-2 border-b border-input p-2">
        <TabsList aria-label="View" activateOnFocus className="gap-px bg-transparent p-0">
          <TabsTrigger value="preview" className={barTab}>
            Preview
          </TabsTrigger>
          <TabsTrigger value="code" className={barTab}>
            Code
          </TabsTrigger>
        </TabsList>
        <Separator orientation="vertical" className="my-1.5" />
        <AdapterSwitch />
        {view === 'code' ? (
          <CopyButton text={source.text} label="Copy code" className="ml-auto" />
        ) : (
          <div className="ml-auto flex gap-1 text-muted-foreground">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
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
              <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Reset" onClick={() => setRun(run + 1)} />}>
                <RotateCcw />
              </TooltipTrigger>
              <TooltipContent>Reset</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
      <div className="relative">
        <TabsContent
          value="preview"
          keepMounted
          render={keepInLayout}
          className="relative flex min-h-[480px] flex-col px-6 pt-10 pb-20 data-hidden:opacity-0"
        >
          <div key={run} className="mx-auto flex w-full max-w-[360px] flex-1 flex-col">
            {apps[adapter]}
          </div>
          <OverlayDock className="pointer-events-none absolute inset-0" overlay={(dock) => <Konat portalTarget={dock} fixtures={fixtures} />}>
            <p className="absolute right-16 bottom-8 m-0 translate-y-1/2 text-[13px] text-muted-foreground">Click the bubble, or press {toggleKeys}.</p>
          </OverlayDock>
        </TabsContent>
        {/* The viewport, not the panel, is the stop for the Tab key. It scrolls with the arrow keys. */}
        <TabsContent value="code" tabIndex={-1} className="absolute inset-0">
          <ScrollArea
            scrollbars="both"
            className="size-full overflow-clip rounded-b-2xl"
            viewportClassName="scroll-fade-xy overscroll-none focus-visible:ring-inset"
          >
            {source.pre}
          </ScrollArea>
        </TabsContent>
      </div>
    </Tabs>
  );
}
