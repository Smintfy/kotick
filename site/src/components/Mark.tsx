export function Mark({ size }: { size: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" />
      <g
        transform="translate(8 8)"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 1.5l5.63 3.25v6.5L8 14.5l-5.63-3.25v-6.5z" />
        <circle cx="8" cy="8" r="2" fill="#ffffff" stroke="none" />
      </g>
    </svg>
  );
}
