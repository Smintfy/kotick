import type { ReactNode } from 'react';

function Icon({ size = 16, className, children }: { size?: number; className?: string; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function HexagonIcon() {
  return (
    <Icon>
      <path d="M8 1.5l5.63 3.25v6.5L8 14.5l-5.63-3.25v-6.5z" />
      <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function CloseIcon() {
  return (
    <Icon>
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </Icon>
  );
}

export function BackIcon() {
  return (
    <Icon>
      <path d="M10 3.5L5.5 8l4.5 4.5" />
    </Icon>
  );
}

/** Points down. CSS turns it to the right while its group is closed. */
export function ChevronIcon({ size, className }: { size: number; className: string }) {
  return (
    <Icon size={size} className={className}>
      <path d="M4 6l4 4 4-4" />
    </Icon>
  );
}

export function GearIcon() {
  return (
    <Icon>
      <path d="M6.29 3.3L6.74 1.52H9.26L9.71 3.3L11.21 4.17L12.98 3.67L14.24 5.85L12.92 7.13V8.87L14.24 10.15L12.98 12.33L11.21 11.83L9.71 12.7L9.26 14.48H6.74L6.29 12.7L4.79 11.83L3.02 12.33L1.76 10.15L3.08 8.87V7.13L1.76 5.85L3.02 3.67L4.79 4.17z" />
      <circle cx="8" cy="8" r="2" />
    </Icon>
  );
}

export function CopyIcon() {
  return (
    <Icon>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5v-2A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2" />
    </Icon>
  );
}
