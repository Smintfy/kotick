'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, type ComponentProps } from 'react';

export function AccordionItem({ id, children }: ComponentProps<'details'>) {
  const ref = useRef<HTMLDetailsElement>(null);

  // A browser opens a closed details only for a target in its answer. The id is on the details, so open it here.
  useEffect(() => {
    const openIfTarget = () => {
      if (ref.current && window.location.hash === `#${id}`) ref.current.open = true;
    };

    openIfTarget();
    window.addEventListener('hashchange', openIfTarget);
    // A Next.js link on the same page changes the hash with pushState, which sends no hashchange event.
    window.navigation?.addEventListener('currententrychange', openIfTarget);

    return () => {
      window.removeEventListener('hashchange', openIfTarget);
      window.navigation?.removeEventListener('currententrychange', openIfTarget);
    };
  }, [id]);

  return (
    <details ref={ref} id={id} className="group border-b border-line last-of-type:border-b-0">
      {children}
    </details>
  );
}

export function AccordionTrigger({ children }: ComponentProps<'summary'>) {
  return (
    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-medium decoration-1 underline-offset-[3px] hover:underline [&::-webkit-details-marker]:hidden">
      <span>{children}</span>
      <ChevronDown className="size-4 flex-none text-muted transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
    </summary>
  );
}
