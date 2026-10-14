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

/** Two states and a transition. */
export function LogoIcon() {
  return (
    <Icon size={18}>
      <rect x="1.75" y="2.25" width="6" height="4.5" rx="1.5" />
      <rect x="8.25" y="9.25" width="6" height="4.5" rx="1.5" />
      <path d="M4.75 6.75v2.75a2 2 0 0 0 2 2h1.5" />
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
