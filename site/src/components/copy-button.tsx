'use client';

import { cn } from 'cn';
import { Check, Copy as CopyIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type CopyProps = {
  className?: string;
  label: string;
  read: (button: HTMLButtonElement) => string;
};

export function useCopy() {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);

    return () => clearTimeout(timer);
  }, [copied]);

  const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => setCopied(true));

  return { copied, copy };
}

function Copy({ className, label, read }: CopyProps) {
  const { copied, copy } = useCopy();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn('text-muted-foreground', className)}
      aria-label={copied ? 'Copied' : label}
      aria-live="polite"
      onClick={(event) => copy(read(event.currentTarget))}
    >
      {copied ? <Check className="size-4" /> : <CopyIcon className="size-4" />}
    </Button>
  );
}

export function CopyButton({ text, label = 'Copy command', className }: { text: string; label?: string; className: string }) {
  return <Copy className={className} label={label} read={() => text} />;
}

export function CopyCodeButton() {
  return (
    <div className="absolute top-2 right-2 flex rounded-[min(var(--radius-md),12px)] bg-background opacity-0 transition-opacity duration-120 ease-[ease] group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100">
      <Copy label="Copy code" read={(button) => button.closest('figure')?.querySelector('pre')?.textContent ?? ''} />
    </div>
  );
}
