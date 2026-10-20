'use client';

import { useEffect, useState } from 'react';

/** Copies text. Without text, it copies the text of the pre next to it. */
export function CopyButton({ text, label = 'Copy' }: { text?: string; label?: string }) {
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
      onClick={(event) => {
        const value = text ?? event.currentTarget.parentElement?.querySelector('pre')?.textContent ?? '';
        void navigator.clipboard.writeText(value).then(() => setCopied(true));
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}
