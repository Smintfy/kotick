import { cn } from 'cn';

function StatelyLogo({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="-18.2 0 223 223"
      width={24}
      height={24}
      role="img"
      aria-label="Stately"
      data-slot="stately-logo"
      className={cn('size-6 shrink-0 text-muted-foreground', className)}
      {...props}
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M128.759 45.638c12.602 0 22.818-10.216 22.818-22.819C151.577 10.217 141.361 0 128.759 0c-12.603 0-22.819 10.217-22.819 22.819 0 12.603 10.216 22.819 22.819 22.819ZM184.043 123.199v-.019L60.863 0c-17.822 17.823-17.722 46.619.101 64.442l39.199 39.199-.066.067 22.215 22.214c.807.807 1.341 1.921 1.341 3.152 0 1.265-.59 2.386-1.437 3.197l-25.91 25.91a4.44 4.44 0 0 1-6.278 0l-25.992-25.993a4.439 4.439 0 0 1 0-6.278c17.734-18.925 4.497-41.58-3.696-49.255l-5.795-5.795L2.6 122.805a8.878 8.878 0 0 0 0 12.555l84.257 84.257a8.876 8.876 0 0 0 12.554 0l84.077-84.077a8.392 8.392 0 0 0 2.987-6.426 8.387 8.387 0 0 0-2.432-5.915Z"
      />
    </svg>
  );
}

export { StatelyLogo };
