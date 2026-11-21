'use client';

import { cn } from 'cn';
import { type ComponentProps, type ReactNode, useState } from 'react';

type OverlayDockProps = Omit<ComponentProps<'div'>, 'ref'> & { overlay: (dock: HTMLDivElement) => ReactNode };

export function OverlayDock({ overlay, className, children, ...props }: OverlayDockProps) {
  const [dock, setDock] = useState<HTMLDivElement | null>(null);

  return (
    <div ref={setDock} className={cn('[contain:layout]', className)} {...props}>
      {children}
      {dock && overlay(dock)}
    </div>
  );
}
