// Page styles can reach the host element, so `:host` resets it with !important.
// Across the shadow boundary, the shadow root's !important declarations beat the page's.
// Sizes are in px, never rem, because the page sets the root font size.

const LIGHT = `
  color-scheme: light;
  --sv-bg: #ffffff;
  --sv-surface: #f4f4f5;
  --sv-hover: #f4f4f5;
  --sv-selected: #e9e9eb;
  --sv-fg: #0a0a0a;
  --sv-muted: #71717a;
  --sv-border: #ececee;
  --sv-outline: rgba(0, 0, 0, 0.1);
  --sv-chip: #e4e4e7;
  --sv-guide: #e4e4e7;
  --sv-segment-on: #ffffff;
  --sv-segment-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  --sv-live: #16a34a;
  --sv-recorded: #15803d;
  --sv-recorded-soft: rgba(22, 163, 74, 0.12);
  --sv-recorded-solid: #16a34a;
  --sv-fixture: #b45309;
  --sv-fixture-soft: rgba(217, 119, 6, 0.14);
  --sv-fixture-solid: #d97706;
  --sv-accent: #2563eb;
  --sv-focus: #2563eb;
  --sv-warn: #b45309;
  --sv-badge: #ef4444;
  --sv-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.12);
  --sv-shadow-lg: 0 2px 6px rgba(0, 0, 0, 0.08), 0 12px 32px rgba(0, 0, 0, 0.16);
  --sv-json-key: #7c3aed;
  --sv-json-string: #15803d;
  --sv-json-number: #1d4ed8;
  --sv-json-literal: #be185d;
`;

const DARK = `
  color-scheme: dark;
  --sv-bg: #0a0a0a;
  --sv-surface: #1a1a1a;
  --sv-hover: #1f1f1f;
  --sv-selected: #2b2b2b;
  --sv-fg: #fafafa;
  --sv-muted: #8b8b8b;
  --sv-border: #232323;
  --sv-outline: rgba(255, 255, 255, 0.1);
  --sv-chip: #333333;
  --sv-guide: #2e2e2e;
  --sv-segment-on: #3a3a3a;
  --sv-segment-shadow: none;
  --sv-live: #22c55e;
  --sv-recorded: #4ade80;
  --sv-recorded-soft: rgba(34, 197, 94, 0.16);
  --sv-recorded-solid: #16a34a;
  --sv-fixture: #fbbf24;
  --sv-fixture-soft: rgba(245, 158, 11, 0.16);
  --sv-fixture-solid: #d97706;
  --sv-accent: #3b82f6;
  --sv-focus: #60a5fa;
  --sv-warn: #fbbf24;
  --sv-badge: #ef4444;
  --sv-shadow: 0 1px 2px rgba(0, 0, 0, 0.5), 0 4px 12px rgba(0, 0, 0, 0.4);
  --sv-shadow-lg: 0 2px 6px rgba(0, 0, 0, 0.4), 0 12px 32px rgba(0, 0, 0, 0.5);
  --sv-json-key: #c084fc;
  --sv-json-string: #4ade80;
  --sv-json-number: #60a5fa;
  --sv-json-literal: #f472b6;
`;

const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`;

/**
 * It is a function, so production builds can remove it.
 * esbuild keeps a top-level template literal with `${…}` parts, because it can't prove they have no side effects.
 */
export function overlayStyles(): string {
  return `
:host {
  all: initial !important;
  display: block !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483647 !important;
  pointer-events: none !important;
}

*, *::before, *::after { box-sizing: border-box; }

.sv-root {${LIGHT}
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial,
    sans-serif;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.4;
  color: var(--sv-fg);
  text-align: left;
  /* "all" leaves direction alone, so the page's would be inherited. */
  direction: ltr;
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  .sv-root:not([data-theme="light"]) {${DARK}}
}
.sv-root[data-theme="dark"] {${DARK}}

button, select, input { font: inherit; color: inherit; margin: 0; }
button { -webkit-tap-highlight-color: transparent; }
h2, h3, p { margin: 0; font: inherit; }
ul, ol { list-style: none; margin: 0; padding: 0; }
code { font-family: ${MONO}; font-size: 11px; }
:focus { outline: none; }
:focus-visible { outline: 2px solid var(--sv-focus); outline-offset: 1px; }

.sv-visually-hidden {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

/* Toolbar */
/* The bubble is near-black on every page. The dark theme adds a light edge, so it shows on dark pages. */
.sv-bubble {
  position: absolute;
  width: 32px;
  height: 32px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 8px;
  background: #0a0a0a;
  color: #ffffff;
  box-shadow: var(--sv-shadow);
  cursor: pointer;
  pointer-events: auto;
  transition: background-color 120ms ease;
}
.sv-bubble:hover { background: #1f1f1f; }
@media (prefers-color-scheme: dark) {
  .sv-root:not([data-theme="light"]) .sv-bubble { border-color: rgba(255, 255, 255, 0.14); }
}
.sv-root[data-theme="dark"] .sv-bubble { border-color: rgba(255, 255, 255, 0.14); }
.sv-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border: 2px solid var(--sv-bg);
  border-radius: 9px;
  background: var(--sv-badge);
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

/* The panel is 10px past the bubble: 16px offset + 32px bubble + 10px gap. */
.sv-root[data-position^="bottom"] .sv-bubble { bottom: 16px; }
.sv-root[data-position^="top"] .sv-bubble { top: 16px; }
.sv-root[data-position$="right"] .sv-bubble { right: 16px; }
.sv-root[data-position$="left"] .sv-bubble { left: 16px; }
.sv-root[data-position^="bottom"] .sv-panel { bottom: 58px; --sv-enter: 6px; }
.sv-root[data-position^="top"] .sv-panel { top: 58px; --sv-enter: -6px; }
.sv-root[data-position$="right"] .sv-panel { right: 16px; }
.sv-root[data-position$="left"] .sv-panel { left: 16px; }

/* Panel */
.sv-panel {
  position: absolute;
  width: 256px;
  max-width: calc(100% - 32px);
  max-height: min(70vh, calc(100% - 80px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--sv-outline);
  border-radius: 12px;
  background: var(--sv-bg);
  box-shadow: var(--sv-shadow-lg);
  pointer-events: auto;
  animation: sv-enter 140ms ease-out;
}
/* Focus lands on the panel or a page only as a fallback; the controls inside show where it is. */
.sv-panel:focus-visible, .sv-page:focus-visible { outline: none; }
@keyframes sv-enter { from { opacity: 0; transform: translateY(var(--sv-enter, 6px)); } }

.sv-header {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  height: 36px;
  padding: 0 6px 0 12px;
  border-bottom: 1px solid var(--sv-border);
}
/* The Back icon lines up with the content below, and the title follows it closely. */
.sv-back { margin: 0 -4px 0 -8px; }
.sv-title {
  overflow: hidden;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sv-close { margin-left: auto; }

.sv-chip {
  display: inline-block;
  flex: none;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 4px;
  background: var(--sv-chip);
  color: var(--sv-fg);
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.sv-code {
  overflow: hidden;
  flex: 0 1 auto;
  min-width: 0;
  height: 18px;
  padding: 0 5px;
  font-family: ${MONO};
  font-weight: 400;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sv-tag {
  flex: none;
  padding: 0 4px;
  border-radius: 4px;
  background: var(--sv-surface);
  color: var(--sv-muted);
  font-size: 10px;
  line-height: 16px;
  white-space: nowrap;
}

.sv-icon-button {
  width: 28px;
  height: 28px;
  padding: 0;
  display: inline-grid;
  place-items: center;
  flex: none;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--sv-muted);
  cursor: pointer;
}
.sv-icon-button:hover { background: var(--sv-hover); color: var(--sv-fg); }
.sv-button {
  height: 20px;
  padding: 0 6px;
  flex: none;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--sv-muted);
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}
.sv-button:hover:not(:disabled) { background: var(--sv-hover); color: var(--sv-fg); }
.sv-button:disabled { opacity: 0.45; cursor: default; }

/* Machine list */
.sv-list { display: flex; flex-direction: column; min-height: 0; }
.sv-rows { display: grid; gap: 2px; padding: 6px; overflow: auto; overscroll-behavior: contain; }
.sv-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 26px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--sv-fg);
  text-align: left;
  cursor: pointer;
}
.sv-row:hover { background: var(--sv-hover); }
.sv-row-name {
  overflow: hidden;
  min-width: 0;
  font-family: ${MONO};
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sv-row-end { flex: none; margin-left: auto; padding-left: 8px; color: var(--sv-muted); font-size: 12px; }
.sv-dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--sv-accent); }
.sv-actions { display: grid; flex: none; padding: 2px 6px; border-top: 1px solid var(--sv-border); }
.sv-action { height: 34px; font-size: 13px; }
.sv-action > :last-child { margin-left: auto; }
.sv-action > svg { color: var(--sv-muted); }
.sv-empty { padding: 16px 12px; color: var(--sv-muted); text-align: center; line-height: 1.5; }

/* Machine and settings pages */
.sv-page { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.sv-instance { flex: none; padding: 6px 6px 0; }
.sv-instance-label {
  overflow: hidden;
  padding: 6px 12px 0;
  color: var(--sv-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sv-select-wrap { position: relative; display: block; min-width: 0; }
.sv-select-wrap::after {
  content: "";
  position: absolute;
  top: 50%;
  right: 10px;
  width: 5px;
  height: 5px;
  margin-top: -4px;
  border-right: 1.5px solid var(--sv-muted);
  border-bottom: 1.5px solid var(--sv-muted);
  transform: rotate(45deg);
  pointer-events: none;
}
.sv-select {
  appearance: none;
  -webkit-appearance: none;
  display: block;
  width: 100%;
  height: 26px;
  padding: 0 24px 0 6px;
  border: 0;
  border-radius: 6px;
  background: var(--sv-surface);
  color: var(--sv-fg);
  font-size: 12px;
  text-overflow: ellipsis;
  cursor: pointer;
}

.sv-body { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; }
.sv-section { padding: 8px 6px; border-bottom: 1px solid var(--sv-border); }
.sv-section:last-child { border-bottom: 0; }
.sv-section-head { display: flex; align-items: center; gap: 6px; min-height: 24px; margin-bottom: 4px; padding-left: 6px; }
.sv-section-title { margin-right: auto; color: var(--sv-muted); font-size: 12px; }
.sv-hint { padding: 0 6px; color: var(--sv-muted); font-size: 12px; }
.sv-hint + .sv-hint, .sv-hint + .sv-tree, .sv-hint + .sv-json { margin-top: 6px; }
.sv-warning { padding: 0 6px; margin-bottom: 6px; color: var(--sv-warn); font-size: 12px; }

.sv-corners { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 0 6px 4px; }
.sv-corner { position: relative; display: block; }
.sv-corner input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.sv-corner span {
  display: grid;
  place-items: center;
  height: 28px;
  border-radius: 6px;
  background: var(--sv-surface);
  color: var(--sv-muted);
  font-size: 12px;
}
.sv-corner input:hover + span { color: var(--sv-fg); }
.sv-corner input:checked + span {
  background: var(--sv-segment-on);
  color: var(--sv-fg);
  box-shadow: var(--sv-segment-shadow);
}
.sv-corner input:focus-visible + span { outline: 2px solid var(--sv-focus); outline-offset: 1px; }
.sv-shortcuts { display: grid; gap: 2px; padding: 0 6px 4px; }
.sv-shortcut {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 24px;
  color: var(--sv-muted);
  font-size: 12px;
}
.sv-keys { display: flex; flex: none; gap: 3px; color: var(--sv-fg); }
kbd {
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 4px;
  background: var(--sv-chip);
  font-family: inherit;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}

/* State tree */
.sv-tree { display: grid; gap: 1px; }
.sv-tree ul { display: grid; gap: 1px; }
.sv-node {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  padding: 2px 6px 2px calc(6px + var(--sv-depth, 0) * 14px);
  border-radius: 6px;
}
.sv-group > .sv-node { color: var(--sv-muted); cursor: pointer; }
.sv-group > .sv-node:hover, .sv-leaf:hover:not([aria-disabled="true"]) { background: var(--sv-hover); }
/* A group's children hang from a guide under the middle of its chevron. */
.sv-group > ul { position: relative; }
.sv-group > ul::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(11.5px + var(--sv-depth) * 14px);
  width: 1px;
  background: var(--sv-guide);
}
.sv-chevron { flex: none; color: var(--sv-muted); transition: transform 100ms ease; }
.sv-group[aria-expanded="false"] > .sv-node .sv-chevron { transform: rotate(-90deg); }
.sv-leaf { cursor: pointer; }
.sv-leaf[aria-disabled="true"] { cursor: default; }
.sv-leaf:focus-visible { outline-offset: -2px; }
.sv-leaf[aria-selected="true"] { background: var(--sv-selected); }
.sv-leaf[aria-selected="true"]:hover { background: var(--sv-selected); }
.sv-leaf[data-filled] { background: color-mix(in srgb, var(--sv-selected) 50%, transparent); }
.sv-label { display: grid; min-width: 0; flex: 1 1 auto; }
.sv-key { overflow: hidden; font-family: ${MONO}; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.sv-description {
  overflow: hidden;
  color: var(--sv-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sv-meta { display: flex; align-items: center; gap: 4px; flex: none; }
.sv-type { color: var(--sv-muted); font-size: 11px; }
.sv-live { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--sv-live); }
.sv-marks { display: flex; flex: none; gap: 2px; }
.sv-data {
  width: 14px;
  height: 14px;
  display: inline-grid;
  place-items: center;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
}
.sv-data[data-kind="recorded"] { background: var(--sv-recorded-soft); color: var(--sv-recorded); }
.sv-data[data-kind="fixture"] { background: var(--sv-fixture-soft); color: var(--sv-fixture); }
.sv-data[data-kind="none"] { border: 1px dashed var(--sv-chip); color: var(--sv-muted); }
.sv-leaf[aria-selected="true"] .sv-data[data-kind="recorded"] { background: var(--sv-recorded-solid); color: #ffffff; }
.sv-leaf[aria-selected="true"] .sv-data[data-kind="fixture"] { background: var(--sv-fixture-solid); color: #ffffff; }
/* The chip gray of the dashed border is too close to the selected gray. */
.sv-leaf[aria-selected="true"] .sv-data[data-kind="none"] { border-color: var(--sv-muted); }

.sv-children { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 8px; padding: 0 6px; }
.sv-children .sv-hint { padding: 0; }
.sv-children .sv-button { background: var(--sv-surface); color: var(--sv-fg); font-family: ${MONO}; font-size: 11px; }

/* Context */
.sv-segmented { display: inline-flex; padding: 2px; border-radius: 7px; background: var(--sv-surface); }
.sv-segment { position: relative; display: inline-flex; }
.sv-segment input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.sv-segment input:disabled { cursor: default; }
.sv-segment span { padding: 0 8px; border-radius: 5px; color: var(--sv-muted); font-size: 12px; line-height: 20px; }
.sv-segment input:checked + span {
  background: var(--sv-segment-on);
  color: var(--sv-fg);
  box-shadow: var(--sv-segment-shadow);
}
.sv-segment input:disabled + span { opacity: 0.45; }
.sv-segment input:focus-visible + span { outline: 2px solid var(--sv-focus); outline-offset: 1px; }
.sv-source { color: var(--sv-muted); font-size: 12px; }

.sv-json {
  max-height: 260px;
  overflow: auto;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--sv-surface);
  font-family: ${MONO};
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
}
.sv-json details > summary { display: block; cursor: pointer; list-style: none; }
.sv-json details > summary::-webkit-details-marker { display: none; }
.sv-json-chevron {
  margin-right: 4px;
  vertical-align: -1px;
  color: var(--sv-muted);
  transition: transform 100ms ease;
}
.sv-json details:not([open]) > summary .sv-json-chevron { transform: rotate(-90deg); }
/* A row without a chevron starts where the keys after a chevron start. */
.sv-json-row { padding-left: 14px; }
.sv-json-children { padding-left: 14px; }
.sv-json-key { color: var(--sv-json-key); }
.sv-json-summary { color: var(--sv-muted); }
.sv-json-string { color: var(--sv-json-string); white-space: pre; }
.sv-json-number { color: var(--sv-json-number); }
.sv-json-boolean, .sv-json-null, .sv-json-undefined { color: var(--sv-json-literal); }
.sv-json-special { color: var(--sv-muted); font-style: italic; }

/* Event log */
.sv-log { display: grid; gap: 2px; }
.sv-log-entry {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1px 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--sv-surface);
}
.sv-event {
  overflow: hidden;
  font-family: ${MONO};
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sv-time { color: var(--sv-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.sv-log-meta, .sv-payload {
  grid-column: 1 / -1;
  overflow: hidden;
  color: var(--sv-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sv-payload { font-family: ${MONO}; }

/* Footer */
.sv-footer { flex: none; padding: 4px 6px; border-top: 1px solid var(--sv-border); }
.sv-copy { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.sv-footer-button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
  height: 30px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--sv-fg);
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}
.sv-footer-button:hover:not(:disabled) { background: var(--sv-hover); }
.sv-footer-button:disabled { opacity: 0.45; cursor: default; }
.sv-footer-button > span { overflow: hidden; text-overflow: ellipsis; }
.sv-footer-button > svg { flex: none; color: var(--sv-muted); }
.sv-footer .sv-warning { margin: 4px 0 2px; }

@media (prefers-reduced-motion: reduce) {
  .sv-panel { animation: none; }
  .sv-bubble, .sv-chevron, .sv-json-chevron { transition: none; }
}
`;
}
