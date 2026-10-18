// Class lists that more than one component uses.
// Each is a whole list, so Tailwind's scanner finds every class.

export const CHIP =
  'inline-block h-4 min-w-4 flex-none rounded-sm bg-chip px-1 text-center text-sm leading-4 font-medium text-fg tabular-nums';

export const TAG = 'flex-none rounded-sm bg-surface px-1 text-xs leading-4 whitespace-nowrap text-muted';

export const BUTTON =
  'h-5 flex-none cursor-pointer rounded-[5px] bg-transparent px-1.5 py-0 text-base whitespace-nowrap text-muted enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-45';

export const BODY = 'min-h-0 flex-auto overflow-auto overscroll-contain';

export const SECTION = 'px-1.5 py-2 not-last:border-b not-last:border-b-line';

export const SECTION_HEAD = 'mb-1 flex min-h-6 items-center gap-1.5 pl-1.5';

export const SECTION_TITLE = 'mr-auto text-base text-muted';

/** A hint right after another hint is 6px below it. */
export const HINT = 'px-1.5 text-base text-muted [[data-part=hint]+&]:mt-1.5';
