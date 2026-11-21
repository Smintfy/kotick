// @vitest-environment-options {"userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"}

import { fireEvent, render } from '@testing-library/react';
import { Kotick } from 'kotick';
import { useMachine } from 'kotick/xstate';
import { describe, expect, test } from 'vitest';
import { createMachine, type AnyStateMachine } from 'xstate';
import { mount } from './support/app';
import { flush, focused, freshId, isOpen, overlay, show } from './support/panel';

async function press(init: KeyboardEventInit, target: Window | Element = window) {
  fireEvent.keyDown(target, init);
  await flush();
}

function control(selector: string): HTMLElement {
  const found = overlay().querySelector<HTMLElement>(selector);

  if (!found) throw new Error(`Nothing in the overlay matches ${selector}.`);

  return found;
}

function Run({ machine }: { machine: AnyStateMachine }) {
  useMachine(machine);

  return null;
}

/** Each row of the Shortcuts section of Settings, as its action and its keys. */
async function settingsShortcuts(): Promise<string[]> {
  fireEvent.click(control('[data-row="settings"]'));
  await flush();

  return [...overlay().querySelectorAll('li')].map(
    (row) =>
      `${row.querySelector('span')?.textContent}: ${[...row.querySelectorAll('kbd')].map((key) => key.textContent).join(' ')}`,
  );
}

test('the tooltips and Settings write the shortcuts as macOS does', async () => {
  render(<Kotick defaultOpen />);
  await flush();

  expect({ bubble: control('button[aria-expanded]').title, settings: await settingsShortcuts() }).toEqual({
    bubble: 'Kotick (⌥S)',
    settings: [
      'Open or close the panel: ⌥S',
      'Previous or next row: ↑ ↓',
      'First or last row: ⌘↑ ⌘↓',
      'Preview or release the state: Enter',
      'Release all previews: Esc',
      'Previous or next machine: [ ]',
    ],
  });
});

describe('the shortcut prop', () => {
  test.each([
    ['ctrl+shift+d', '⌃⇧D', { key: 'd', code: 'KeyD', ctrlKey: true, shiftKey: true }],
    ['mod+k', '⌘K', { key: 'k', code: 'KeyK', metaKey: true }],
    ['shift+cmd+option+esc', '⌥⇧⌘Esc', { key: 'Escape', code: 'Escape', metaKey: true, altKey: true, shiftKey: true }],
  ])('%s shows as %s and toggles the panel', async (shortcut, label, init) => {
    render(<Kotick shortcut={shortcut} />);
    await flush();
    await press(init);

    expect({ open: isOpen(), bubble: control('button[aria-expanded]').title }).toEqual({
      open: true,
      bubble: `Kotick (${label})`,
    });
  });
});

test('⌘↑ and ⌘↓ go to the first and last row of the machine list, and to the first and last state of a machine', async () => {
  const machine = createMachine({
    id: freshId('checkout'),
    initial: 'editing',
    states: { editing: {}, processing: {}, success: {} },
  });

  await mount(<Run machine={machine} />);
  control('[data-row]').focus();

  const seen: string[] = [];
  const row = () => focused(HTMLElement)?.dataset.row ?? 'none';
  const leaf = () => focused(HTMLElement)?.dataset.leaf ?? 'none';

  for (const key of ['ArrowDown', 'ArrowUp']) {
    await press({ key, metaKey: true }, focused(HTMLElement) ?? window);
    seen.push(`list ⌘${key}: ${row()}`);
  }

  await show(machine.id);
  control('[role="treeitem"][tabindex="0"]').focus();

  for (const key of ['ArrowDown', 'ArrowUp']) {
    await press({ key, metaKey: true }, focused(HTMLElement) ?? window);
    seen.push(`page ⌘${key}: ${leaf()}`);
  }

  expect(seen).toEqual([
    'list ⌘ArrowDown: settings',
    'list ⌘ArrowUp: machine',
    'page ⌘ArrowDown: success',
    'page ⌘ArrowUp: editing',
  ]);
});
