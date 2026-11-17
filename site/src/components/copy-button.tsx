'use client';

import { Check, Copy as CopyIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type CopyProps = {
  className: string;
  label: string;
  read: (button: HTMLButtonElement) => string;
};

function Copy({ className, label, read }: CopyProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);

    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={`text-muted-on-surface ${className}`}
      aria-label={copied ? 'Copied' : label}
      aria-live="polite"
      onClick={(event) => void navigator.clipboard.writeText(read(event.currentTarget)).then(() => setCopied(true))}
    >
      {copied ? <Check className="size-4" /> : <CopyIcon className="size-4" />}
    </Button>
  );
}

export function CopyButton({ text, className }: { text: string; className: string }) {
  return <Copy className={className} label="Copy command" read={() => text} />;
}

export function CopyCodeButton() {
  return (
    // The hover color of the button is translucent. Thus, a solid wrapper keeps the code from showing through it.
    <div className="absolute top-2 right-2 flex rounded-[min(var(--radius-md),12px)] bg-bg opacity-0 transition-opacity duration-120 ease-[ease] group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100">
      <Copy
        className=""
        label="Copy code"
        read={(button) => button.closest('figure')?.querySelector('pre')?.textContent ?? ''}
      />
    </div>
  );
}
