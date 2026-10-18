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
      className="sv-panel"
      data-page={props.page}
      aria-label="State viewer"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <header className="sv-header">
        {props.onBack && (
          <button type="button" className="sv-icon-button sv-back" onClick={props.onBack} aria-label="Back" title="Back">
            <BackIcon />
          </button>
        )}
        <h2 className="sv-title">{props.title}</h2>
        {props.chips}
        <button
          type="button"
          className="sv-icon-button sv-close"
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
