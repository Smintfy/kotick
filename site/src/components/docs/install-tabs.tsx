'use client';

import { type ReactNode, useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { AdapterSwitch, useAdapter, useInlineSwitch } from '@/components/docs/adapter-tabs';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Adapter } from '@/content/adapters';

export type InstallCommand = { manager: string; text: string; code: ReactNode };

function InstallBlock({ commands, aside }: { commands: readonly InstallCommand[]; aside?: ReactNode }) {
  const [selected, setSelected] = useState(commands[0]?.manager);
  const current = commands.find((command) => command.manager === selected) ?? commands[0];

  return (
    <Tabs value={selected} onValueChange={setSelected} className="my-6 gap-2">
      <div className="flex items-center justify-between gap-2">
        <TabsList aria-label="Package manager" activateOnFocus>
          {commands.map(({ manager }) => (
            <TabsTrigger key={manager} value={manager}>
              {manager}
            </TabsTrigger>
          ))}
        </TabsList>
        {aside}
      </div>
      <div className="flex items-center gap-2 rounded-xl py-2 pr-2 pl-4 shadow-edge">
        {commands.map(({ manager, code }) => (
          <TabsContent key={manager} value={manager} className="min-w-0 overflow-x-auto">
            <code className="m-0 bg-transparent p-0 text-[0.8rem] whitespace-nowrap shadow-none">{code}</code>
          </TabsContent>
        ))}
        <CopyButton text={current?.text ?? ''} className="ml-auto" />
      </div>
    </Tabs>
  );
}

export function InstallTabs({ commands }: { commands: readonly InstallCommand[] }) {
  return <InstallBlock commands={commands} />;
}

/** The install commands of each adapter, with the adapter menu beside the package managers and the note of the adapter below. */
export function AdapterInstallTabs({
  commands,
  children,
}: {
  commands: Record<Adapter, readonly InstallCommand[]>;
  children?: ReactNode;
}) {
  const [adapter] = useAdapter();
  const inline = useInlineSwitch();

  return (
    <>
      <InstallBlock commands={commands[adapter]} aside={inline && <AdapterSwitch />} />
      {children && <Tabs value={adapter}>{children}</Tabs>}
    </>
  );
}
