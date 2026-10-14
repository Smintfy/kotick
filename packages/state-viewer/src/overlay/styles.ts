// Styles injected into the overlay's shadow root (R20, §10.6). Page styles can still reach the host element itself,
// so `:host` resets it with !important, which beats the page's own !important declarations across the shadow
// boundary. Sizes are in px, never rem, since the page sets the root font size.

const LIGHT = `
  color-scheme: light;
  --sv-bg: #ffffff;
  --sv-surface: #f5f5f7;
  --sv-hover: rgba(24, 24, 27, 0.06);
  --sv-fg: #18181b;
  --sv-muted: #63636e;
  --sv-border: #e4e4e7;
  --sv-accent: #4f46e5;
  --sv-accent-soft: rgba(79, 70, 229, 0.1);
  --sv-accent-fg: #3730a3;
  --sv-on-accent: #ffffff;
  --sv-live: #15803d;
  --sv-live-soft: rgba(21, 128, 61, 0.12);
  --sv-fixture: #a16207;
  --sv-fixture-soft: rgba(202, 138, 4, 0.14);
  --sv-warn: #b45309;
  --sv-badge: #e11d48;
  --sv-focus: #4f46e5;
  --sv-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.12);
  --sv-shadow-lg: 0 2px 6px rgba(0, 0, 0, 0.08), 0 12px 32px rgba(0, 0, 0, 0.16);
  --sv-json-key: #6d28d9;
  --sv-json-string: #047857;
  --sv-json-number: #1d4ed8;
  --sv-json-literal: #be185d;
`;

const DARK = `
  color-scheme: dark;
  --sv-bg: #18181b;
  --sv-surface: #222226;
  --sv-hover: rgba(244, 244, 245, 0.07);
  --sv-fg: #f4f4f5;
  --sv-muted: #a1a1aa;
  --sv-border: #34343a;
  --sv-accent: #818cf8;
  --sv-accent-soft: rgba(129, 140, 248, 0.16);
  --sv-accent-fg: #c7d2fe;
  --sv-on-accent: #111827;
  --sv-live: #4ade80;
  --sv-live-soft: rgba(74, 222, 128, 0.14);
  --sv-fixture: #fbbf24;
  --sv-fixture-soft: rgba(251, 191, 36, 0.14);
  --sv-warn: #fbbf24;
  --sv-badge: #fb7185;
  --sv-focus: #a5b4fc;
  --sv-shadow: 0 1px 2px rgba(0, 0, 0, 0.5), 0 4px 12px rgba(0, 0, 0, 0.4);
  --sv-shadow-lg: 0 2px 6px rgba(0, 0, 0, 0.4), 0 12px 32px rgba(0, 0, 0, 0.5);
  --sv-json-key: #c4b5fd;
  --sv-json-string: #6ee7b7;
  --sv-json-number: #93c5fd;
  --sv-json-literal: #f9a8d4;
`;

const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`;

/**
 * The overlay's style sheet.
 * It is a function, so production builds can remove it (spec §10.7).
 * Minifiers keep a top-level template literal with `${…}` parts, because they can't be sure it has no side effects.
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
.sv-bubble {
  position: absolute;
  width: 40px;
  height: 40px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 1px solid var(--sv-border);
  border-radius: 50%;
  background: var(--sv-bg);
  color: var(--sv-fg);
  box-shadow: var(--sv-shadow);
  cursor: pointer;
  pointer-events: auto;
  transition: transform 120ms ease, background-color 120ms ease;
}
.sv-bubble:hover { transform: scale(1.06); }
.sv-bubble[data-previewing] { background: var(--sv-accent); color: var(--sv-on-accent); border-color: transparent; }
.sv-badge {
  position: absolute;
  top: -5px;
  right: -5px;
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

.sv-root[data-position^="bottom"] .sv-bubble { bottom: 16px; }
.sv-root[data-position^="top"] .sv-bubble { top: 16px; }
.sv-root[data-position$="right"] .sv-bubble { right: 16px; }
.sv-root[data-position$="left"] .sv-bubble { left: 16px; }
.sv-root[data-position^="bottom"] .sv-panel { bottom: 64px; --sv-enter: 6px; }
.sv-root[data-position^="top"] .sv-panel { top: 64px; --sv-enter: -6px; }
.sv-root[data-position$="right"] .sv-panel { right: 16px; }
.sv-root[data-position$="left"] .sv-panel { left: 16px; }

/* Panel */
.sv-panel {
  position: absolute;
  width: 320px;
  max-width: calc(100% - 32px);
  max-height: min(70vh, calc(100% - 80px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--sv-border);
  border-radius: 10px;
  background: var(--sv-bg);
  box-shadow: var(--sv-shadow-lg);
  pointer-events: auto;
  animation: sv-enter 140ms ease-out;
}
/* Focus lands on the panel itself only as a fallback; the controls inside show where it is. */
.sv-panel:focus-visible { outline: none; }
@keyframes sv-enter { from { opacity: 0; transform: translateY(var(--sv-enter, 6px)); } }

.sv-header {
  display: grid;
  gap: 8px;
  padding: 8px 8px 10px 12px;
  border-bottom: 1px solid var(--sv-border);
}
.sv-titlebar { display: flex; align-items: center; gap: 2px; min-height: 28px; }
.sv-title { margin-right: auto; font-size: 13px; font-weight: 600; }
.sv-title-count { margin-left: 6px; color: var(--sv-accent-fg); font-weight: 500; font-size: 11px; }
.sv-pickers { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding-right: 4px; }
.sv-pickers[data-single] { grid-template-columns: 1fr; }

.sv-select-wrap { position: relative; min-width: 0; }
.sv-select-wrap::after {
  content: "";
  position: absolute;
  top: 50%;
  right: 10px;
  width: 6px;
  height: 6px;
  margin-top: -5px;
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
  height: 28px;
  padding: 0 24px 0 8px;
  border: 1px solid var(--sv-border);
  border-radius: 6px;
  background: var(--sv-surface);
  color: var(--sv-fg);
  font-size: 12px;
  text-overflow: ellipsis;
  cursor: pointer;
}
.sv-select:disabled { cursor: default; opacity: 0.6; }

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
.sv-icon-button:hover:not(:disabled) { background: var(--sv-hover); color: var(--sv-fg); }
.sv-button {
  height: 24px;
  padding: 0 8px;
  flex: none;
  border: 1px solid var(--sv-border);
  border-radius: 6px;
  background: var(--sv-bg);
  color: var(--sv-fg);
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.sv-button:hover:not(:disabled) { background: var(--sv-hover); }
.sv-button:disabled, .sv-icon-button:disabled { opacity: 0.45; cursor: default; }

.sv-body { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; }
.sv-section { padding: 10px 12px 12px; border-bottom: 1px solid var(--sv-border); }
.sv-section:last-child { border-bottom: 0; }
.sv-section-head { display: flex; align-items: center; gap: 6px; min-height: 24px; margin-bottom: 6px; }
.sv-section-title {
  margin-right: auto;
  color: var(--sv-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.sv-hint { color: var(--sv-muted); font-size: 11px; }
.sv-hint + .sv-hint, .sv-hint + .sv-tree, .sv-hint + .sv-json { margin-top: 6px; }
.sv-warning { color: var(--sv-warn); font-size: 11px; margin-bottom: 6px; }
.sv-empty { padding: 20px 16px; color: var(--sv-muted); text-align: center; line-height: 1.5; }

/* State tree */
.sv-tree { display: grid; gap: 1px; }
.sv-tree ul { display: grid; gap: 1px; }
.sv-node {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 26px;
  padding: 3px 6px 3px calc(6px + var(--sv-depth, 0) * 14px);
  border-radius: 6px;
}
.sv-group > .sv-node { min-height: 22px; color: var(--sv-muted); }
.sv-leaf { cursor: pointer; }
.sv-leaf[aria-disabled="true"] { cursor: default; }
.sv-leaf:hover:not([aria-disabled="true"]) { background: var(--sv-hover); }
.sv-leaf:focus-visible { outline-offset: -2px; }
.sv-leaf[aria-selected="true"] { background: var(--sv-accent-soft); color: var(--sv-accent-fg); }
.sv-leaf[data-filled] { background: linear-gradient(90deg, var(--sv-accent-soft), transparent 70%); }
.sv-live {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: transparent;
}
.sv-live[data-on] { background: var(--sv-live); box-shadow: 0 0 0 3px var(--sv-live-soft); }
.sv-label { display: grid; min-width: 0; flex: 1 1 auto; }
.sv-key { overflow: hidden; font-family: ${MONO}; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.sv-description {
  overflow: hidden;
  color: var(--sv-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sv-leaf[aria-selected="true"] .sv-description { color: inherit; opacity: 0.8; }
.sv-meta { display: flex; align-items: center; gap: 3px; flex: none; }
.sv-tag {
  padding: 0 5px;
  border: 1px solid var(--sv-border);
  border-radius: 4px;
  color: var(--sv-muted);
  font-size: 10px;
  line-height: 15px;
  white-space: nowrap;
}
.sv-type { color: var(--sv-muted); font-size: 10px; }
.sv-pin {
  padding: 0 5px;
  border-radius: 4px;
  background: var(--sv-accent);
  color: var(--sv-on-accent);
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
}
.sv-data {
  width: 16px;
  height: 16px;
  display: inline-grid;
  place-items: center;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 700;
}
.sv-data[data-kind="recorded"] { background: var(--sv-live-soft); color: var(--sv-live); }
.sv-data[data-kind="fixture"] { background: var(--sv-fixture-soft); color: var(--sv-fixture); }
.sv-data[data-kind="none"] { border: 1px dashed var(--sv-border); color: var(--sv-muted); }
.sv-legend { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 8px; color: var(--sv-muted); font-size: 10px; }
.sv-legend > span { display: inline-flex; align-items: center; gap: 4px; }

.sv-children { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 8px; }

/* Context */
.sv-segmented {
  display: inline-flex;
  padding: 1px;
  border: 1px solid var(--sv-border);
  border-radius: 6px;
  background: var(--sv-surface);
}
.sv-segment { position: relative; display: inline-flex; }
.sv-segment input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.sv-segment input:disabled { cursor: default; }
.sv-segment span { padding: 1px 7px; border-radius: 4px; color: var(--sv-muted); font-size: 11px; line-height: 18px; }
.sv-segment input:checked + span {
  background: var(--sv-bg);
  color: var(--sv-fg);
  box-shadow: 0 0 0 1px var(--sv-border);
}
.sv-segment input:disabled + span { opacity: 0.45; }
.sv-segment input:focus-visible + span { outline: 2px solid var(--sv-focus); outline-offset: 1px; }
.sv-source {
  padding: 0 6px;
  border-radius: 4px;
  background: var(--sv-surface);
  color: var(--sv-muted);
  font-size: 11px;
  line-height: 18px;
}

.sv-json {
  max-height: 260px;
  overflow: auto;
  padding: 6px 8px;
  border: 1px solid var(--sv-border);
  border-radius: 6px;
  background: var(--sv-surface);
  font-family: ${MONO};
  font-size: 11px;
  line-height: 1.55;
  white-space: nowrap;
}
.sv-json details > summary { display: block; cursor: pointer; list-style: none; }
.sv-json details > summary::-webkit-details-marker { display: none; }
.sv-json details > summary::before {
  content: "";
  display: inline-block;
  width: 0;
  height: 0;
  margin: 0 5px 1px 0;
  border-top: 3.5px solid transparent;
  border-bottom: 3.5px solid transparent;
  border-left: 5px solid var(--sv-muted);
  transition: transform 100ms ease;
}
.sv-json details[open] > summary::before { transform: rotate(90deg); }
.sv-json-row { padding-left: 10px; }
.sv-json-children { padding-left: 12px; }
.sv-json-key { color: var(--sv-json-key); }
.sv-json-summary { color: var(--sv-muted); }
.sv-json-string { color: var(--sv-json-string); white-space: pre; }
.sv-json-number { color: var(--sv-json-number); }
.sv-json-boolean, .sv-json-null, .sv-json-undefined { color: var(--sv-json-literal); }
.sv-json-special { color: var(--sv-muted); font-style: italic; }

/* Event log */
.sv-log { display: grid; gap: 4px; }
.sv-log-entry {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1px 8px;
  padding: 6px 8px;
  border: 1px solid var(--sv-border);
  border-radius: 6px;
  background: var(--sv-surface);
}
.sv-event { overflow: hidden; font-family: ${MONO}; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
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
.sv-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid var(--sv-border);
  background: var(--sv-surface);
}
.sv-status { margin-left: auto; color: var(--sv-muted); font-size: 11px; }
.sv-footer .sv-warning { flex-basis: 100%; margin: 0; }

@media (prefers-reduced-motion: reduce) {
  .sv-panel { animation: none; }
  .sv-bubble, .sv-json details > summary::before { transition: none; }
  .sv-bubble:hover { transform: none; }
}
`;
}
