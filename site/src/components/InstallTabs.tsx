'use client';

import { useRef, useState } from 'react';
import { CopyButton } from '@/components/CopyButton';

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
    <div className="install">
      <div
        role="tablist"
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
      <div
        className="install-command"
        role="tabpanel"
        id="install-command"
        aria-labelledby={`install-${managers[selected].name}`}
      >
        <code>{command}</code>
        <CopyButton text={command} />
      </div>
    </div>
  );
}
