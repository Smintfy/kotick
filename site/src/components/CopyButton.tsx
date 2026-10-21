'use client';

import { useEffect, useState } from 'react';

type CopyProps = { label: string; className: string; read: (button: HTMLButtonElement) => string };

function Copy({ label, className, read }: CopyProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);

    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className={`cursor-pointer rounded-md px-2.5 py-1.5 text-[12px] leading-none font-medium hover:bg-selected ${className}`}
      aria-live="polite"
      onClick={(event) => void navigator.clipboard.writeText(read(event.currentTarget)).then(() => setCopied(true))}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className: string }) {
  return <Copy label={label} className={className} read={() => text} />;
}

export function CopyCodeButton() {
  return (
    <Copy
      label="Copy"
      className="absolute top-2 right-2 bg-bg opacity-0 transition-opacity duration-120 ease-[ease] group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100"
      read={(button) => button.parentElement?.querySelector('pre')?.textContent ?? ''}
    />
  );
}
