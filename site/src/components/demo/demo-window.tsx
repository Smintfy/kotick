'use client';

import { RotateCcw, SquareArrowOutUpRight } from 'lucide-react';
import { type ComponentProps, type ReactNode, useState } from 'react';
import { type FixturesInput, Shiru } from 'shiru';
import { CopyButton } from '@/components/copy-button';
import { AdapterSwitch, useAdapter } from '@/components/docs/adapter-tabs';
import { barTab } from '@/components/docs/bar-tab';
import { useIsApple } from '@/components/docs/shortcut';
import { OverlayDock } from '@/components/overlay-dock';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Adapter } from '@/content/adapters';
import type { DemoSources } from '@/components/demo/source';

const keepInLayout = (props: ComponentProps<'div'>) => <div {...props} hidden={false} />;

type DemoWindowProps = { apps: Record<Adapter, ReactNode>; fixtures: FixturesInput; href: string; sources: DemoSources };

export function DemoWindow({ apps, fixtures, href, sources }: DemoWindowProps) {
  const [adapter] = useAdapter();
  const source = sources[adapter];
  const [run, setRun] = useState(0);
  const [view, setView] = useState<'preview' | 'code'>('preview');
  const [fileName, setFileName] = useState(source.files[0].name);
  const file = source.files.find(({ name }) => name === fileName) ?? source.files[0];
  const toggleKeys = useIsApple() ? '⌥S' : 'Alt+S';

  return (
    <Tabs value={view} onValueChange={setView} render={<figure />} className="not-prose my-6 gap-2">
      <div className="flex items-center gap-2">
        <TabsList aria-label="View" activateOnFocus>
          <TabsTrigger value="preview">
            Preview
          </TabsTrigger>
          <TabsTrigger value="code">
            Code
          </TabsTrigger>
        </TabsList>
        <div className="ml-auto">
          <AdapterSwitch />
        </div>
      </div>
      <div className="relative rounded-2xl shadow-edge">
        {view === 'preview' && (
          <div className="absolute top-2 right-2 z-10 flex gap-1 text-muted-foreground">
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
        <TabsContent
          value="preview"
          keepMounted
          render={keepInLayout}
          className="relative flex min-h-[480px] flex-col px-6 pt-10 pb-20 data-hidden:opacity-0"
        >
          <div key={run} className="mx-auto flex w-full max-w-[360px] flex-1 flex-col">
            {apps[adapter]}
          </div>
          <OverlayDock className="pointer-events-none absolute inset-x-0 top-10 bottom-0" overlay={(dock) => <Shiru portalTarget={dock} fixtures={fixtures} />}>
            <p className="absolute right-16 bottom-8 m-0 translate-y-1/2 text-[0.8rem] text-muted-foreground">Click the bubble, or press {toggleKeys}.</p>
          </OverlayDock>
        </TabsContent>
        <TabsContent value="code" tabIndex={-1} className="absolute inset-0">
          <Tabs value={fileName} onValueChange={setFileName} className="size-full gap-0">
            <div className="flex items-center gap-2 border-b border-input p-2">
              <TabsList
                aria-label="File"
                activateOnFocus
                className="scroll-fade-x min-w-0 justify-start gap-px overflow-x-auto overflow-y-hidden bg-transparent p-0 [scrollbar-width:none]"
              >
                {source.files.map(({ name }) => (
                  <TabsTrigger key={name} value={name} className={barTab}>
                    {name}
                  </TabsTrigger>
                ))}
              </TabsList>
              <CopyButton text={file.text} label={`Copy ${file.name}`} className="ml-auto" />
            </div>
            {source.files.map(({ name, pre }) => (
              // The viewport, not the panel, is the stop for the Tab key. It scrolls with the arrow keys.
              <TabsContent key={name} value={name} tabIndex={-1} className="min-h-0">
                <ScrollArea
                  scrollbars="both"
                  className="size-full overflow-clip rounded-b-2xl"
                  viewportClassName="scroll-fade-xy overscroll-none focus-visible:ring-inset"
                >
                  {pre}
                </ScrollArea>
              </TabsContent>
            ))}
          </Tabs>
        </TabsContent>
      </div>
    </Tabs>
  );
}
