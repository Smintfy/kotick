'use client';

import { Check, ChevronDown, Copy } from 'lucide-react';
import { useCopy } from '@/components/copy-button';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupSeparator } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function MarkdownIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M6 15V9l3 3 3-3v6M15 12l2.5 3 2.5-3M17.5 15V9" />
    </svg>
  );
}

/** The "Copy page" button beside the title of a docs page. The menu also opens the Markdown copy of the page. */
export function PageActions({ markdown, markdownHref }: { markdown: string; markdownHref: string }) {
  const { copied, copy } = useCopy();

  return (
    // One hairline around the group. A hairline on each button doubles where the two hairlines touch.
    <ButtonGroup className="shrink-0 rounded-lg shadow-code *:shadow-none">
      <Button variant="outline" size="sm" className="gap-1.5 text-[13px] font-normal" onClick={() => copy(markdown)} aria-live="polite">
        {copied ? <Check /> : <Copy />}
        {copied ? 'Copied' : 'Copy page'}
      </Button>
      <ButtonGroupSeparator className="bg-input data-vertical:my-0" />
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" aria-label="More ways to use this page" />}>
          <ChevronDown className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto">
          <DropdownMenuItem onClick={() => copy(markdown)}>
            <Copy />
            Copy page
          </DropdownMenuItem>
          <DropdownMenuLinkItem href={markdownHref} target="_blank" rel="noopener">
            <MarkdownIcon />
            View as Markdown
          </DropdownMenuLinkItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}
