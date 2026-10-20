'use client';

import { useEffect, useState } from 'react';

function Copy({ label, read }: { label: string; read: (button: HTMLButtonElement) => string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className="copy"
      aria-live="polite"
      onClick={(event) => void navigator.clipboard.writeText(read(event.currentTarget)).then(() => setCopied(true))}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  return <Copy label={label} read={() => text} />;
}

export function CopyCodeButton() {
  return <Copy label="Copy" read={(button) => button.parentElement?.querySelector('pre')?.textContent ?? ''} />;
}
