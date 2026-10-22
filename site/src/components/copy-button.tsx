'use client';

import { Check, Copy as CopyIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

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
    <button
      type="button"
      className={`grid size-7 cursor-pointer place-items-center rounded-md text-muted-on-surface hover:bg-selected hover:text-fg ${className}`}
      aria-label={copied ? 'Copied' : label}
      aria-live="polite"
      onClick={(event) => void navigator.clipboard.writeText(read(event.currentTarget)).then(() => setCopied(true))}
    >
      {copied ? <Check className="size-4" /> : <CopyIcon className="size-4" />}
    </button>
  );
}

export function CopyButton({ text, className }: { text: string; className: string }) {
  return <Copy className={className} label="Copy command" read={() => text} />;
}

export function CopyCodeButton() {
  return (
    <Copy
      className="absolute top-2 right-2 bg-bg opacity-0 transition-opacity duration-120 ease-[ease] group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100"
      label="Copy code"
      read={(button) => button.parentElement?.querySelector('pre')?.textContent ?? ''}
    />
  );
}
