// Drives <StateViewer /> the way a developer does, and reads what its overlay shows.
// Render it next to the components under test first, with defaultOpen for the functions that use the panel.

import { act, fireEvent } from '@testing-library/react';

/** Waits for React to render and for the registry to publish, which it does in a microtask. */
export async function flush(): Promise<void> {
  await act(async () => {});
}

let count = 0;

/**
 * Returns a machine id that no earlier test in the file used.
 * The page keeps one registry for the whole file.
 * A fresh id keeps the recordings, fixtures and one-time warnings of earlier tests away.
 */
export function freshId(name: string): string {
  count += 1;
  return `${name}-${count}`;
}

/** The overlay's shadow root, for what the other helpers don't read, such as focus, tooltips and the corner. */
export function overlay(): ShadowRoot {
  const root = document.querySelector('[data-state-viewer-root]')?.shadowRoot;
  if (!root) throw new Error('Render <StateViewer /> first.');
  return root;
}

function all<T extends Element = HTMLElement>(selector: string): T[] {
  return [...overlay().querySelectorAll<T>(selector)];
}

function one<T extends Element = HTMLElement>(selector: string): T {
  const found = overlay().querySelector<T>(selector);
  if (!found) throw new Error(`Nothing in the overlay matches ${selector}.`);
  return found;
}

function button(text: string): HTMLButtonElement | undefined {
  return all<HTMLButtonElement>('button').find((candidate) => candidate.textContent === text);
}

async function click(element: Element): Promise<void> {
  fireEvent.click(element);
  await flush();
}

async function choose(select: HTMLSelectElement, value: string): Promise<void> {
  fireEvent.change(select, { target: { value } });
  await flush();
}

export function isOpen(): boolean {
  return one('button[aria-expanded]').getAttribute('aria-expanded') === 'true';
}

/** Shows an instance in the panel: picks its machine, then the nth instance of that machine in registration order. */
export async function show(machineId: string, nth = 1): Promise<void> {
  await choose(one('select[aria-label="Machine"]'), machineId);
  const instances = one<HTMLSelectElement>('select[aria-label="Instance"]');
  const option = instances.options[nth - 1];
  if (!option) throw new Error(`${machineId} has no instance ${nth}.`);
  await choose(instances, option.value);
}

type Source = 'recorded' | 'fixture' | 'live';

/**
 * Previews leaves of an instance the way a developer does.
 * It releases the instance's preview, then clicks each leaf in the state tree.
 * A click puts its leaf first, so the leaves are clicked last to first.
 * Then `source` picks the context source.
 */
export async function preview(
  machineId: string,
  leaves: string[],
  { nth = 1, source }: { nth?: number; source?: Source } = {},
): Promise<void> {
  await show(machineId, nth);
  const release = button('Release');
  if (release) await click(release);
  for (const leaf of [...leaves].reverse()) await click(one(`[data-leaf="${leaf}"]`));
  if (source) await pickSource(source);
}

export async function pickSource(source: Source): Promise<void> {
  await click(one(`[aria-label="Context source"] input[value="${source}"]`));
}

export async function release(machineId: string, nth = 1): Promise<void> {
  await show(machineId, nth);
  const found = button('Release');
  if (!found) throw new Error(`Instance ${nth} of ${machineId} has no preview to release.`);
  await click(found);
}

export async function releaseAll(): Promise<void> {
  const found = button('Release all');
  if (!found) throw new Error('The panel has no Release all button.');
  await click(found);
}

/** The data marks of each leaf in the shown tree, by leaf id: `recorded`, `fixture` or `none`. */
export function marks(): Record<string, string[]> {
  return Object.fromEntries(
    all('[data-leaf]').map((leaf) => [
      leaf.dataset.leaf,
      [...leaf.querySelectorAll<HTMLElement>('.sv-data[data-kind]')].map((mark) => mark.dataset.kind),
    ]),
  );
}

/**
 * Clicks Copy link or Copy JSON, and returns the text it copied and the status it showed.
 * jsdom has no clipboard and no execCommand, so the overlay copies through a textarea in its shadow root and
 * shows "Copy failed". A MutationObserver reads the textarea before the overlay removes it.
 */
export async function copy(label: 'Copy link' | 'Copy JSON'): Promise<{ copied: string[]; status: string }> {
  const found = button(label);
  if (!found) throw new Error(`The panel has no ${label} button.`);
  const copied: string[] = [];
  const read = (records: MutationRecord[]) => {
    for (const record of records) {
      for (const node of record.addedNodes) if (node instanceof HTMLTextAreaElement) copied.push(node.value);
    }
  };
  const observer = new MutationObserver(read);
  observer.observe(overlay(), { childList: true, subtree: true });
  await click(found);
  read(observer.takeRecords());
  observer.disconnect();
  return { copied, status: one('[role="status"]').textContent ?? '' };
}

/** The key of the shown instance. Warnings name an instance by its key. */
export function shownKey(): string {
  return one<HTMLSelectElement>('select[aria-label="Instance"]').value;
}

/** What the panel shows about the shown instance, as one value for one toEqual. */
export function panel() {
  const leaves = all('[data-leaf]');
  const pick = (test: (leaf: HTMLElement) => boolean) => leaves.filter(test).map((leaf) => leaf.dataset.leaf);
  return {
    instance: one<HTMLSelectElement>('select[aria-label="Instance"]').selectedOptions[0]?.textContent,
    live: pick((leaf) => leaf.hasAttribute('data-active')),
    previewed: pick((leaf) => leaf.getAttribute('aria-selected') === 'true'),
    filled: pick((leaf) => leaf.hasAttribute('data-filled')),
    source: overlay().querySelector<HTMLInputElement>('[aria-label="Context source"] input:checked')?.value ?? 'none',
    context: all('.sv-json-row, .sv-json summary').map((row) => row.textContent),
    warning: overlay().querySelector('.sv-section .sv-warning')?.textContent ?? '',
  };
}
