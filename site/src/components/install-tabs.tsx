'use client';

import { useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const managers = [
  { name: 'npm', add: 'npm install' },
  { name: 'pnpm', add: 'pnpm add' },
  { name: 'yarn', add: 'yarn add' },
  { name: 'bun', add: 'bun add' },
] as const;

type Manager = (typeof managers)[number];

export function InstallTabs({ name }: { name: string }) {
  const [selected, setSelected] = useState<Manager['name']>('npm');
  const command = (manager: Manager) => `${manager.add} ${name}`;
  const current = managers.find((manager) => manager.name === selected) ?? managers[0];

  return (
    <Tabs value={selected} onValueChange={setSelected} className="mb-6 gap-0 rounded-xl bg-surface">
      <div className="flex items-center gap-2 border-b border-chip p-2">
        <TabsList aria-label="Package manager" activateOnFocus>
          {managers.map((manager) => (
            <TabsTrigger key={manager.name} value={manager.name} className="px-2">
              {manager.name}
            </TabsTrigger>
          ))}
        </TabsList>
        <CopyButton text={command(current)} className="ml-auto" />
      </div>
      {managers.map((manager) => (
        <TabsContent key={manager.name} value={manager.name} className="px-5 py-4">
          <code className="bg-transparent p-0 text-[13px]">{command(manager)}</code>
        </TabsContent>
      ))}
    </Tabs>
  );
}
