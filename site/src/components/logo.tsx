/** The konat mark. It uses the text color of its parent. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="12 12 96 96" fill="currentColor" aria-hidden="true" className={className}>
      <path
        fillRule="evenodd"
        d="M12 60A16 16 0 0 1 28 44L60 44A16 16 0 0 1 76 60L76 92A16 16 0 0 1 60 108L28 108A16 16 0 0 1 12 92zM76 12a32 32 0 1 0 0 64 32 32 0 0 0 0-64z"
      />
    </svg>
  );
}
