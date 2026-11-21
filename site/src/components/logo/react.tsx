import { cn } from 'cn';

function ReactLogo({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="-11.5 -11.5 23 23"
      width={24}
      height={24}
      role="img"
      aria-label="React"
      data-slot="react-logo"
      className={cn('size-6 shrink-0 text-muted-foreground', className)}
      {...props}
    >
      <circle r="2.05" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1" fill="none">
        <ellipse rx="11" ry="4.2" />
        <ellipse rx="11" ry="4.2" transform="rotate(60)" />
        <ellipse rx="11" ry="4.2" transform="rotate(120)" />
      </g>
    </svg>
  );
}

export { ReactLogo };
