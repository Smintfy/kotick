'use client';

import { type ReactNode, useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { barTab } from '@/components/docs/bar-tab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type InstallCommand = { manager: string; text: string; code: ReactNode };

export function InstallTabs({ commands }: { commands: readonly InstallCommand[] }) {
  const [selected, setSelected] = useState(commands[0]?.manager);
  const current = commands.find((command) => command.manager === selected) ?? commands[0];

  return (
    <Tabs value={selected} onValueChange={setSelected} className="mb-6 gap-0 rounded-xl shadow-code">
      <div className="flex items-center gap-2 border-b border-input p-2">
        <TabsList aria-label="Package manager" activateOnFocus className="gap-px bg-transparent p-0">
          {commands.map(({ manager }) => (
            <TabsTrigger key={manager} value={manager} className={barTab}>
              {manager}
            </TabsTrigger>
          ))}
        </TabsList>
        <CopyButton text={current?.text ?? ''} className="ml-auto" />
      </div>
      {commands.map(({ manager, code }) => (
        <TabsContent key={manager} value={manager} className="px-4 py-4">
          <code className="m-0 bg-transparent p-0 text-[13px] shadow-none">{code}</code>
        </TabsContent>
      ))}
    </Tabs>
  );
}
