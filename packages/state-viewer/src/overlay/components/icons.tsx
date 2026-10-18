import type { ReactNode } from 'react';

function Icon({ size = 16, children }: { size?: number; children: ReactNode }) {
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
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** A state as a hexagon, with a dot for the current one. */
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

/** Moves the panel to the next corner. */
export function CornerIcon() {
  return (
    <Icon>
      <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2" />
      <rect x="8.5" y="8.5" width="3.25" height="3.25" rx="0.75" fill="currentColor" stroke="none" />
    </Icon>
  );
}
