// Each constant is a whole class list, so Tailwind's scanner finds every class.

export const CHIP =
  'inline-block h-4 min-w-4 flex-none rounded-sm bg-chip px-1 text-center text-sm leading-4 font-medium text-fg tabular-nums';

export const TAG = 'flex-none rounded-sm bg-surface px-1 text-xs leading-4 whitespace-nowrap text-muted';

export const BUTTON =
  'h-5 flex-none cursor-pointer rounded-[5px] bg-transparent px-1.5 py-0 text-base whitespace-nowrap text-muted enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-45';

/** A full-width row. Every row in the panel is 32px high. */
export const ROW =
  'flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-md bg-transparent px-1.5 py-0 text-left text-fg enabled:hover:bg-hover';

/** A row with a label and an icon or a chip at the end. */
export const ACTION =
  'flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-md bg-transparent px-1.5 py-0 text-left text-lg whitespace-nowrap text-fg enabled:hover:bg-hover [&>:last-child]:ml-auto [&>svg]:flex-none [&>svg]:text-muted';

/** The rows at the bottom of a page. */
export const FOOTER = 'grid flex-none gap-0.5 border-t border-t-line p-1.5';

export const BODY = 'min-h-0 flex-auto overflow-auto overscroll-contain';

export const SECTION = 'px-1.5 py-2 not-last:border-b not-last:border-b-line';

export const SECTION_HEAD = 'mb-1 flex min-h-6 items-center gap-1.5 pl-1.5';

export const SECTION_TITLE = 'mr-auto text-base text-muted';

/** A hint right after another hint is 6px below it. */
export const HINT = 'px-1.5 text-base text-muted [[data-part=hint]+&]:mt-1.5';

/** A warning above the content of its section. */
export const WARNING = 'mb-1.5 px-1.5 text-base text-warn';
