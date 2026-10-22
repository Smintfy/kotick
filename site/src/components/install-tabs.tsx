'use client';

import { SquareTerminal } from 'lucide-react';
import { useRef, useState } from 'react';
import { CopyButton } from '@/components/copy-button';

const managers = [
  { name: 'npm', add: 'npm install' },
  { name: 'pnpm', add: 'pnpm add' },
  { name: 'yarn', add: 'yarn add' },
  { name: 'bun', add: 'bun add' },
] as const;

export function InstallTabs({ name }: { name: string }) {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const command = `${managers[selected].add} ${name}`;

  const select = (index: number) => {
    const next = (index + managers.length) % managers.length;
    setSelected(next);
    tabs.current[next]?.focus();
  };

  return (
    <div className="mb-6 rounded-xl bg-surface">
      <div className="flex items-center gap-2 border-b border-chip p-2">
        <SquareTerminal className="ml-1 size-4 text-muted-on-surface" />
        <div
          role="tablist"
          className="flex gap-px"
          aria-label="Package manager"
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') select(selected + 1);

            if (event.key === 'ArrowLeft') select(selected - 1);
          }}
        >
          {managers.map((manager, index) => (
            <button
              key={manager.name}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              type="button"
              role="tab"
              className="cursor-pointer rounded-md h-7 border border-transparent px-2 text-[13px] text-muted-on-surface aria-selected:border-chip aria-selected:bg-bg aria-selected:text-fg"
              id={`install-${manager.name}`}
              aria-selected={index === selected}
              aria-controls="install-command"
              tabIndex={index === selected ? 0 : -1}
              onClick={() => setSelected(index)}
            >
              {manager.name}
            </button>
          ))}
        </div>
        <CopyButton text={command} className="ml-auto" />
      </div>
      <div
        className="px-5 py-4"
        role="tabpanel"
        id="install-command"
        aria-labelledby={`install-${managers[selected].name}`}
      >
        <code className="bg-transparent p-0 text-[13px]">{command}</code>
      </div>
    </div>
  );
}
