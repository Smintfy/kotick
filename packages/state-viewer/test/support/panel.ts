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

/** The Back button of a machine page or the settings page. The machine list has none. */
function backButton(): HTMLButtonElement | null {
  return overlay().querySelector<HTMLButtonElement>('button[aria-label="Back"]');
}

/** Clicks Back until the panel shows the machine list. */
async function toList(): Promise<void> {
  for (let clicks = 0; clicks < 2; clicks += 1) {
    const back = backButton();
    if (!back) return;
    await click(back);
  }
  throw new Error('Back does not lead to the machine list.');
}

/**
 * Shows an instance in the panel, as a developer picks it.
 * It goes back to the machine list and clicks the machine's row, unless the page of that machine shows already.
 * On a machine with more than one instance, it then picks the nth instance in registration order.
 * Inside another act(), React 18 shows a new page only when that act() ends, so open the page before such a step.
 */
export async function show(machineId: string, nth = 1): Promise<void> {
  if (shownMachine() !== machineId) {
    await toList();
    const row = all<HTMLButtonElement>('button[data-machine]').find((found) => found.dataset.machine === machineId);
    if (!row) throw new Error(`The machine list has no ${machineId}.`);
    await click(row);
  }
  const instances = overlay().querySelector<HTMLSelectElement>('select[aria-label="Instance"]');
  if (!instances) {
    if (nth !== 1) throw new Error(`${machineId} has one instance, so it has no instance ${nth}.`);
    return;
  }
  const option = instances.options[nth - 1];
  if (!option) throw new Error(`${machineId} has no instance ${nth}.`);
  await choose(instances, option.value);
}

/** Clicks the row of a compound or parallel state in the tree, by its key, to collapse or expand it. */
export async function toggleState(key: string): Promise<void> {
  const row = all('[role="treeitem"][aria-expanded] > [data-part="node"]').find(
    (found) => found.querySelector('[data-part="key"]')?.textContent === key,
  );
  if (!row) throw new Error(`The tree has no state ${key} with states in it.`);
  await click(row);
}

type Source = 'recorded' | 'fixture' | 'live';

/**
 * Previews leaves of an instance the way a developer does.
 * It releases the instance's preview, then clicks each leaf in the state tree.
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
  // A click puts its leaf first, so the last leaf is clicked first.
  const clickOrder = [...leaves].reverse();
  for (const leaf of clickOrder) await click(one(`[data-leaf="${leaf}"]`));
  if (source) await pickSource(source);
}

/** Clicks a leaf of the shown tree. The leaf joins the instance's preview, or leaves it when it is in it already. */
export async function clickLeaf(leaf: string): Promise<void> {
  await click(one(`[data-leaf="${leaf}"]`));
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

/**
 * Goes to the machine list and clicks Release all. The list shows it only while a preview is on.
 * On the list already, it clicks before it waits, so the click comes before the registry's next flush.
 */
export async function releaseAll(): Promise<void> {
  if (backButton()) await toList();
  const found = all<HTMLButtonElement>('button').find(
    (candidate) => candidate.querySelector('[data-part="row-label"]')?.textContent === 'Release all',
  );
  if (!found) throw new Error('The machine list has no Release all button.');
  await click(found);
}

/** The data marks of each leaf in the shown tree, by leaf id: `recorded`, `fixture` or `none`. */
export function marks(): Record<string, string[]> {
  return Object.fromEntries(
    all('[data-leaf]').map((leaf) => [
      leaf.dataset.leaf,
      [...leaf.querySelectorAll<HTMLElement>('[data-kind]')].map((mark) => mark.dataset.kind),
    ]),
  );
}

/** The rows of the blocked-event log, newest first, as `EVENT · instance · in leaves`, then the payload if any. */
export function blockedEvents(): string[] {
  return all('[data-part="log-entry"]').map((row) => {
    const event = row.querySelector('[data-part="event"]')?.textContent;
    const where = row.querySelector('[data-part="log-meta"]')?.textContent;
    const payload = row.querySelector('[data-part="payload"]')?.textContent;
    return [event, where, payload].filter((part) => part !== undefined).join(' · ');
  });
}

/**
 * Clicks Copy link or Copy JSON, and returns the text it copied and the status it showed.
 * jsdom has no clipboard and no execCommand, so the overlay copies through a textarea in its shadow root and
 * shows "Copy failed". A MutationObserver reads the textarea before the overlay removes it.
 */
export async function copy(label: 'Copy link' | 'Copy JSON'): Promise<{ copied: string[]; status: string }> {
  const found = overlay().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
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

/** The machine whose page the panel shows, as the page's title gives it, or `none` on another page. */
export function shownMachine(): string {
  return overlay().querySelector('[data-page="machine"] h2')?.textContent ?? 'none';
}

/** Goes to the settings page from the machine list, and picks a corner, such as `Bottom left`. */
export async function pickCorner(label: string): Promise<void> {
  await toList();
  const settings = all<HTMLButtonElement>('button').find(
    (candidate) => candidate.querySelector('[data-part="row-label"]')?.textContent === 'Settings',
  );
  if (!settings) throw new Error('The machine list has no Settings button.');
  await click(settings);
  const corner = all<HTMLLabelElement>('[role="radiogroup"] label').find((found) => found.textContent === label);
  if (!corner) throw new Error(`The settings page has no corner ${label}.`);
  await click(corner.querySelector('input') ?? corner);
}

/** The name of the shown instance, such as `checkout · 1`, as the label of its state tree gives it. */
function shownName(): string | undefined {
  return overlay().querySelector('[role="tree"]')?.getAttribute('aria-label')?.replace(/^States of /, '');
}

/** The key of the shown instance. Warnings name an instance by its key. */
export function shownKey(): string {
  return one('[data-instance]').dataset.instance ?? '';
}

/** The keys of the shown machine's instances, in registration order: the values of the Instance options. */
export function instanceKeys(): string[] {
  const picker = overlay().querySelector<HTMLSelectElement>('select[aria-label="Instance"]');
  return picker ? [...picker.options].map((option) => option.value) : [shownKey()];
}

/**
 * Goes to the machine list and returns its rows, such as `checkout-3 · child · 2 instances · previewing`.
 * A row names the machine, then `child` when all its instances are child machines, the number of instances when
 * there is more than one, and `previewing` while one of them is previewed.
 */
export async function machines(): Promise<string[]> {
  await toList();
  return all('button[data-machine]').map((row) => {
    const parts = [row.querySelector('[data-part="row-name"]')?.textContent ?? ''];
    const tag = row.querySelector('[data-part="tag"]')?.textContent;
    if (tag) parts.push(tag);
    const count = row.querySelector('[data-part="chip"]')?.textContent;
    if (count) parts.push(`${count} instances`);
    const previewing = row.querySelector('[data-part="dot"]')?.textContent?.replace(/^, /, '');
    if (previewing) parts.push(previewing);
    return parts.join(' · ');
  });
}

/**
 * The instances that the shown machine page names, or [] on another page.
 * With more than one, they are the Instance options, with ` ●` after a previewed one.
 * With one, the page has no picker, and it is the name of the instance.
 */
export function instances(): string[] {
  const picker = overlay().querySelector<HTMLSelectElement>('select[aria-label="Instance"]');
  if (picker) return [...picker.options].map((option) => option.textContent ?? '');
  const name = shownName();
  return name === undefined ? [] : [name];
}

/** The count on the bubble's badge: the number of active previews, or '' while none is on. */
export function badge(): string {
  return overlay().querySelector('[data-part="badge"]')?.textContent ?? '';
}

/** What the machine page shows about the shown instance, as one value for one toEqual. */
export function panel() {
  one('[data-instance]');
  const leaves = all('[data-leaf]');
  const pick = (test: (leaf: HTMLElement) => boolean) => leaves.filter(test).map((leaf) => leaf.dataset.leaf);
  return {
    instance: shownName(),
    live: pick((leaf) => leaf.hasAttribute('data-active')),
    previewed: pick((leaf) => leaf.getAttribute('aria-selected') === 'true'),
    filled: pick((leaf) => leaf.hasAttribute('data-filled')),
    source: overlay().querySelector<HTMLInputElement>('[aria-label="Context source"] input:checked')?.value ?? 'none',
    context: all('[data-part="json-row"], [data-testid="sv-json"] summary').map((row) => row.textContent),
    warning: overlay().querySelector('section[aria-labelledby] [data-part="warning"]')?.textContent ?? '',
  };
}
