import { fireEvent, render, screen } from '@testing-library/react';
import { Shiru } from 'shiru';
import { useMachine } from 'shiru/xstate';
import { describe, expect, onTestFinished, test } from 'vitest';
import { createMachine, setup, type AnyStateMachine } from 'xstate';
import { mount } from './support/app';
import { watchConsole } from './support/console';
import {
  flush,
  focused,
  freshId,
  isOpen,
  overlay,
  panel,
  preview,
  show,
  shownMachine,
  toggleState,
} from './support/panel';

const ALT_S = { key: 's', code: 'KeyS', altKey: true };

async function press(init: KeyboardEventInit, target: Window | Element = window) {
  fireEvent.keyDown(target, init);
  await flush();
}

function createCheckoutMachine() {
  return createMachine({
    id: freshId('checkout'),
    type: 'parallel',
    states: {
      shipping: { initial: 'standard', states: { standard: {}, express: {} } },
      payment: { initial: 'editing', states: { editing: {}, processing: {}, error: {}, success: { type: 'final' } } },
    },
  });
}

function createToggleMachine() {
  return createMachine({ id: freshId('toggle'), initial: 'off', states: { off: {}, on: {} } });
}

function Run({ machine }: { machine: AnyStateMachine }) {
  useMachine(machine);

  return null;
}

function focusedInOverlay(): HTMLElement {
  const found = overlay().activeElement;

  if (!(found instanceof HTMLElement)) throw new Error('Nothing in the overlay has focus.');

  return found;
}

function focusedLeaf(): string {
  return focused(HTMLElement)?.dataset.leaf ?? 'none';
}

function tabStop(): HTMLElement {
  const stop = overlay().querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]');

  if (!stop) throw new Error('The tree has no tab stop.');

  return stop;
}

function tabStops(): string {
  return [...overlay().querySelectorAll<HTMLElement>('[role="treeitem"][tabindex="0"]')]
    .map((stop) => stop.dataset.leaf)
    .join(', ');
}

function control(selector: string): HTMLElement {
  const found = overlay().querySelector<HTMLElement>(selector);

  if (!found) throw new Error(`Nothing in the overlay matches ${selector}.`);

  return found;
}

function focusedRow(): string {
  const row = focused(HTMLElement);

  if (!row?.hasAttribute('data-row')) return 'none';

  return row.dataset.machine ?? row.querySelector('[data-part="row-label"]')?.textContent ?? '';
}

async function click(element: Element): Promise<void> {
  fireEvent.click(element);
  await flush();
}

test('Alt+S opens the panel and closes it again, by its physical key too, as Alt+S types ß on macOS', async () => {
  render(<Shiru />);
  await flush();

  const open: boolean[] = [];

  for (const init of [
    ALT_S,
    ALT_S,
    { key: 'ß', code: 'KeyS', altKey: true },
    { key: 'S', code: 'KeyS', altKey: true },
    // Another modifier or another key does nothing.
    { key: 's', code: 'KeyS' },
    { key: 's', code: 'KeyS', altKey: true, shiftKey: true },
    { key: 'd', code: 'KeyD', altKey: true },
  ]) {
    await press(init);
    open.push(isOpen());
  }

  expect(open).toEqual([true, false, true, false, false, false, false]);
});

describe('the shortcut prop', () => {
  test.each([
    ['Shift + Ctrl + 1', { key: '1', code: 'Digit1', ctrlKey: true, shiftKey: true }],
    ['cmd+option+esc', { key: 'Escape', code: 'Escape', metaKey: true, altKey: true }],
    ['mod+k', { key: 'k', code: 'KeyK', ctrlKey: true }],
  ])('takes modifiers in any case and order, and their aliases: %s', async (shortcut, init) => {
    render(<Shiru shortcut={shortcut} />);
    await flush();

    await press(init);
    expect(isOpen()).toBe(true);
  });

  test('an unknown modifier or a missing key turns the shortcut off with a warning, and false turns it off without one', async () => {
    const output = watchConsole();
    const { rerender } = render(<Shiru shortcut="hyper+s" />);
    await flush();
    rerender(<Shiru shortcut="alt+" />);
    await flush();
    rerender(<Shiru shortcut={false} />);
    await flush();

    await press(ALT_S);
    expect({ open: isOpen(), warnings: output.warn }).toEqual({
      open: false,
      warnings: [
        '[shiru] Ignoring the shortcut "hyper+s": expected something like "alt+s".',
        '[shiru] Ignoring the shortcut "alt+": expected something like "alt+s".',
      ],
    });
  });

  test('the tooltips of the bubble and the Close button name the shortcut, as Windows and Linux write it', async () => {
    const tooltips = () => ({
      bubble: control('button[aria-expanded]').title,
      close: control('button[aria-label="Close"]').title,
    });

    const { rerender } = render(<Shiru defaultOpen />);
    await flush();

    const seen = [tooltips()];
    rerender(<Shiru defaultOpen shortcut="ctrl+shift+d" />);
    seen.push(tooltips());
    rerender(<Shiru defaultOpen shortcut="shift+mod+cmd+esc" />);
    seen.push(tooltips());
    rerender(<Shiru defaultOpen shortcut={false} />);
    seen.push(tooltips());
    expect(seen).toEqual([
      { bubble: 'Shiru (Alt+S)', close: 'Close (Alt+S)' },
      { bubble: 'Shiru (Ctrl+Shift+D)', close: 'Close (Ctrl+Shift+D)' },
      { bubble: 'Shiru (Ctrl+Shift+Super+Esc)', close: 'Close (Ctrl+Shift+Super+Esc)' },
      { bubble: 'Shiru', close: 'Close' },
    ]);
  });
});

describe('focus', () => {
  test('opening with the shortcut puts focus on the tree, and closing gives it back where the shortcut was pressed', async () => {
    const machine = createCheckoutMachine();
    localStorage.setItem('shiru:ui', JSON.stringify({ v: 1, machine: machine.id }));
    render(
      <>
        <Run machine={machine} />
        <button type="button">Pay</button>
        <Shiru />
      </>,
    );
    await flush();
    const pay = screen.getByRole('button', { name: 'Pay' });
    pay.focus();

    await press(ALT_S, pay);
    const opened = { open: isOpen(), focus: focusedLeaf() };
    await press(ALT_S, focusedInOverlay());
    expect({ opened, closed: { open: isOpen(), focus: document.activeElement?.textContent } }).toEqual({
      opened: { open: true, focus: 'shipping.standard' },
      closed: { open: false, focus: 'Pay' },
    });
  });

  test('opening on the machine list puts focus on its first row, a page puts it on its tree or its checked corner, and Back on the row that opened it', async () => {
    const checkout = createCheckoutMachine();
    const toggle = createToggleMachine();
    render(
      <>
        <Run machine={checkout} />
        <Run machine={toggle} />
        <Shiru position="bottom-left" />
      </>,
    );
    await flush();
    await press(ALT_S);
    const first = focusedRow();
    await press({ key: 'ArrowDown' }, focusedInOverlay());

    await click(focusedInOverlay());
    const opened = { machine: shownMachine(), focus: focusedLeaf() };
    await click(control('button[aria-label="Back"]'));
    const back = focusedRow();
    await click(control('[data-row="settings"]'));
    const corner = focused(HTMLInputElement)?.value;
    await click(control('button[aria-label="Back"]'));
    expect({ first, opened, back, corner, backFromSettings: focusedRow() }).toEqual({
      first: checkout.id,
      opened: { machine: toggle.id, focus: 'off' },
      back: toggle.id,
      corner: 'bottom-left',
      backFromSettings: 'Settings',
    });
  });

  test('a click on another page leaves focus outside the panel where it is', async () => {
    const machine = createCheckoutMachine();
    await mount(
      <>
        <Run machine={machine} />
        <button type="button">Pay</button>
      </>,
    );
    screen.getByRole('button', { name: 'Pay' }).focus();

    await show(machine.id);
    expect({ machine: shownMachine(), focus: document.activeElement?.textContent }).toEqual({
      machine: machine.id,
      focus: 'Pay',
    });
  });
});

describe('in the panel', () => {
  test('arrows, Home and End move through the leaves, Enter previews or releases one, and Escape releases all', async () => {
    const checkout = createCheckoutMachine();
    const toggle = createToggleMachine();
    await mount(
      <>
        <Run machine={checkout} />
        <Run machine={checkout} />
        <Run machine={toggle} />
      </>,
    );
    await preview(toggle.id, ['on']);
    await show(checkout.id);
    tabStop().focus();

    const step = (key: string) => {
      const bubble = control('button[aria-expanded]').getAttribute('aria-label');

      return `${key}: focus ${focusedLeaf()}, stops ${tabStops()}, previewed [${panel().previewed}], ${bubble}`;
    };

    const steps = [step('start')];

    // A control keeps the keys that it handles itself.
    // Arrows change a select, and Enter clicks a button.
    const keys: [string, HTMLElement?][] = [
      ['ArrowDown'],
      ['ArrowDown'],
      ['ArrowUp'],
      ['ArrowDown', control('select[aria-label="Instance"]')],
      ['Enter', control('button[aria-label="Close"]')],
      ['End'],
      ['Enter'],
      ['Enter'],
      ['Home'],
      ['Enter'],
      ['Escape'],
    ];

    for (const [key, target] of keys) {
      await press({ key }, target ?? focusedInOverlay());
      steps.push(step(target ? `${key} on ${target.localName}` : key));
    }

    expect(steps).toEqual([
      'start: focus shipping.standard, stops shipping.standard, previewed [], Shiru, 1 preview active',
      'ArrowDown: focus shipping.express, stops shipping.express, previewed [], Shiru, 1 preview active',
      'ArrowDown: focus payment.editing, stops payment.editing, previewed [], Shiru, 1 preview active',
      'ArrowUp: focus shipping.express, stops shipping.express, previewed [], Shiru, 1 preview active',
      'ArrowDown on select: focus shipping.express, stops shipping.express, previewed [], Shiru, 1 preview active',
      'Enter on button: focus shipping.express, stops shipping.express, previewed [], Shiru, 1 preview active',
      'End: focus payment.success, stops payment.success, previewed [], Shiru, 1 preview active',
      'Enter: focus payment.success, stops payment.success, previewed [payment.success], Shiru, 2 previews active',
      'Enter: focus payment.success, stops payment.success, previewed [], Shiru, 1 preview active',
      'Home: focus shipping.standard, stops shipping.standard, previewed [], Shiru, 1 preview active',
      'Enter: focus shipping.standard, stops shipping.standard, previewed [shipping.standard], Shiru, 2 previews active',
      'Escape: focus shipping.standard, stops shipping.standard, previewed [], Shiru',
    ]);
  });

  test('arrows, Home and End skip the leaves of a collapsed state, and the tab stop moves off them', async () => {
    const checkout = createCheckoutMachine();
    await mount(<Run machine={checkout} />);
    await show(checkout.id);
    await toggleState('shipping');
    tabStop().focus();

    const seen = [`start: ${focusedLeaf()}`];

    for (const key of ['ArrowUp', 'End', 'ArrowDown', 'Home']) {
      await press({ key }, focusedInOverlay());
      seen.push(`${key}: ${focusedLeaf()}`);
    }

    expect(seen).toEqual([
      'start: payment.editing',
      'ArrowUp: payment.editing',
      'End: payment.success',
      'ArrowDown: payment.success',
      'Home: payment.editing',
    ]);
  });

  test('arrows, Home and End move through the rows of the machine list', async () => {
    const checkout = createCheckoutMachine();
    const toggle = createToggleMachine();
    await mount(
      <>
        <Run machine={checkout} />
        <Run machine={toggle} />
      </>,
    );
    await preview(toggle.id, ['on']);
    await click(control('button[aria-label="Back"]'));
    control('[data-row]').focus();

    const seen = [focusedRow()];

    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp', 'Home', 'End']) {
      await press({ key }, focusedInOverlay());
      seen.push(`${key}: ${focusedRow()}`);
    }

    expect(seen).toEqual([
      checkout.id,
      `ArrowDown: ${toggle.id}`,
      'ArrowDown: Release all',
      'ArrowDown: Settings',
      'ArrowDown: Settings',
      'ArrowUp: Release all',
      `Home: ${checkout.id}`,
      'End: Settings',
    ]);
  });

  test('[ and ] show the previous and next machine, wrap around, and keep focus on the tab stop of the tree', async () => {
    const checkout = createCheckoutMachine();
    const toggle = createToggleMachine();
    const fetcher = createMachine({ id: freshId('fetcher'), initial: 'loading', states: { loading: {}, failed: {} } });

    const parent = setup({ actors: { fetcher } }).createMachine({
      id: freshId('parent'),
      initial: 'active',
      states: { active: { invoke: { id: 'load', src: 'fetcher' } } },
    });

    await mount(
      <>
        <Run machine={checkout} />
        <Run machine={toggle} />
        <Run machine={parent} />
      </>,
    );
    await show(checkout.id);
    tabStop().focus();

    const seen = [];

    for (const key of [']', '[', '[']) {
      await press({ key }, focusedInOverlay());
      seen.push(`${key}: ${shownMachine()} at ${focusedLeaf()}`);
    }

    expect(seen).toEqual([
      `]: ${toggle.id} at off`,
      `[: ${checkout.id} at shipping.standard`,
      `[: ${fetcher.id} at loading`,
    ]);
  });
});

test('a press in a text field types, also inside another shadow root, so it never toggles the panel', async () => {
  render(
    <>
      <input aria-label="text" />
      <textarea aria-label="area" />
      <div contentEditable suppressContentEditableWarning>
        <span>inside editable</span>
      </div>
      <input aria-label="box" type="checkbox" />
      <button type="button">button</button>
      <Shiru />
    </>,
  );
  await flush();
  const host = document.createElement('div');
  const shadowInput = document.createElement('input');
  host.attachShadow({ mode: 'open' }).append(shadowInput);
  document.body.append(host);
  onTestFinished(() => {
    host.remove();
  });

  const toggled: Record<string, boolean> = {};

  const fields = {
    text: screen.getByLabelText('text'),
    area: screen.getByLabelText('area'),
    editable: screen.getByText('inside editable'),
    shadowInput,
    box: screen.getByLabelText('box'),
    button: screen.getByRole('button', { name: 'button' }),
  };

  for (const [name, field] of Object.entries(fields)) {
    const before = isOpen();
    await press(ALT_S, field);
    toggled[name] = isOpen() !== before;
  }

  expect(toggled).toEqual({ text: false, area: false, editable: false, shadowInput: false, box: true, button: true });
});
