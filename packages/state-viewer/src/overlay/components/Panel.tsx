// The panel's shell around the page that Overlay picks: a header with Back, the page's title and chips, and Close.
// Escape releases every preview on every page. Each page handles its other keys.

import type * as React from 'react';
import type { PanelPage } from '../model';
import { isTyping } from '../shortcut';
import { BackIcon, CloseIcon } from './icons';

interface PanelProps {
  id: string;
  panelRef: React.Ref<HTMLElement>;
  page: PanelPage['kind'];
  title: string;
  /** Counts and the path, after the title. */
  chips?: React.ReactNode;
  /** Shows the Back button. */
  onBack: (() => void) | undefined;
  /** Shown in the close button's tooltip, such as 'Alt+S'. */
  shortcutLabel: string | undefined;
  onClose(): void;
  onReleaseAll(): void;
  children: React.ReactNode;
}

export function Panel(props: PanelProps) {
  function onKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.key !== 'Escape' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (isTyping(event.target as HTMLElement)) return;
    event.preventDefault();
    props.onReleaseAll();
  }

  return (
    <section
      ref={props.panelRef}
      id={props.id}
      // The panel is 10px past the bubble: 16px offset + 32px bubble + 10px gap. It slides in from the bubble.
      // Focus lands on the panel only as a fallback, and the controls inside show where it is.
      className="pointer-events-auto absolute flex max-h-[min(70vh,calc(100%-80px))] w-70 max-w-[calc(100%-32px)] animate-enter flex-col overflow-hidden rounded-xl border border-outline bg-bg [box-shadow:var(--sv-shadow-lg)] focus-visible:[outline:none] in-data-[position$=left]:left-4 in-data-[position$=right]:right-4 in-data-[position^=bottom]:bottom-14.5 in-data-[position^=bottom]:[--sv-enter:6px] in-data-[position^=top]:top-14.5 in-data-[position^=top]:[--sv-enter:-6px] motion-reduce:animate-none"
      data-page={props.page}
      aria-label="State viewer"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <header className="flex h-9 flex-none items-center gap-1.5 border-b border-b-line pr-1.5 pl-3">
        {props.onBack && (
          // The Back icon lines up with the content below, and the title follows it closely.
          <button
            type="button"
            className="-mr-1 -ml-2 inline-grid size-7 flex-none cursor-pointer place-items-center rounded-md bg-transparent p-0 text-muted hover:bg-hover hover:text-fg"
            onClick={props.onBack}
            aria-label="Back"
            title="Back"
          >
            <BackIcon />
          </button>
        )}
        <h2 className="min-w-0 truncate text-lg font-medium">{props.title}</h2>
        {props.chips}
        <button
          type="button"
          className="ml-auto inline-grid size-7 flex-none cursor-pointer place-items-center rounded-md bg-transparent p-0 text-muted hover:bg-hover hover:text-fg"
          onClick={props.onClose}
          aria-label="Close"
          title={props.shortcutLabel ? `Close (${props.shortcutLabel})` : 'Close'}
        >
          <CloseIcon />
        </button>
      </header>
      {props.children}
    </section>
  );
}
