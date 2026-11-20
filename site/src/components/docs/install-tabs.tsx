'use client';

import { type ReactNode, useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { outerTab } from '@/components/docs/bar-tab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type InstallCommand = { manager: string; text: string; code: ReactNode };

export function InstallTabs({ commands }: { commands: readonly InstallCommand[] }) {
  const [selected, setSelected] = useState(commands[0]?.manager);
  const current = commands.find((command) => command.manager === selected) ?? commands[0];

  return (
    <Tabs value={selected} onValueChange={setSelected} className="my-6 gap-2">
      <TabsList aria-label="Package manager" activateOnFocus className="gap-px bg-transparent p-0">
        {commands.map(({ manager }) => (
          <TabsTrigger key={manager} value={manager} className={outerTab}>
            {manager}
          </TabsTrigger>
        ))}
      </TabsList>
      <div className="flex items-center gap-2 rounded-xl py-2 pr-2 pl-4 shadow-edge">
        {commands.map(({ manager, code }) => (
          <TabsContent key={manager} value={manager} className="min-w-0 overflow-x-auto">
            <code className="m-0 bg-transparent p-0 text-[13px] whitespace-nowrap shadow-none">{code}</code>
          </TabsContent>
        ))}
        <CopyButton text={current?.text ?? ''} className="ml-auto" />
      </div>
    </Tabs>
  );
}
