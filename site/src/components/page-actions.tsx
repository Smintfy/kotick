'use client';

import { Check, Copy } from 'lucide-react';
import { useCopy } from '@/components/copy-button';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

function MarkdownIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M6 15V9l3 3 3-3v6M15 12l2.5 3 2.5-3M17.5 15V9" />
    </svg>
  );
}

const action = 'font-normal text-muted-foreground';

export function PageActions({ markdown, markdownHref }: { markdown: string; markdownHref: string }) {
  const { copied, copy } = useCopy();

  return (
    <div className="-ml-2.5 flex flex-wrap items-center gap-1">
      <Button variant="ghost" size="sm" className={action} onClick={() => copy(markdown)}>
        {copied ? <Check /> : <Copy />}
        Copy page
        <span className="sr-only" aria-live="polite">
          {copied ? 'Copied' : ''}
        </span>
      </Button>
      <Separator orientation="vertical" className="bg-input data-vertical:h-4 data-vertical:self-center" />
      <Button
        variant="ghost"
        size="sm"
        className={action}
        nativeButton={false}
        render={<a href={markdownHref} target="_blank" rel="noopener" />}
      >
        <MarkdownIcon />
        View as Markdown
      </Button>
    </div>
  );
}
