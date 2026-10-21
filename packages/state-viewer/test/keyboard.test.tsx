import { fireEvent, render, screen } from '@testing-library/react';
import { StateViewer } from 'state-viewer';
import { useMachine } from 'state-viewer/xstate';
import { describe, expect, test } from 'vitest';
import { createMachine, setup, type AnyStateMachine } from 'xstate';
import { watchConsole } from './support/console';
import { flush, freshId, isOpen, overlay, panel, preview, show, shownMachine, toggleState } from './support/panel';

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

/** The element that has focus inside the overlay. */
function focusedInOverlay(): HTMLElement {
  const focused = overlay().activeElement;

  if (!(focused instanceof HTMLElement)) throw new Error('Nothing in the overlay has focus.');

  return focused;
}

/** The leaf that has focus, or `none`. */
function focusedLeaf(): string {
  return (overlay().activeElement as HTMLElement | null)?.dataset.leaf ?? 'none';
}

/** The leaf in the tab order. Tab moves into the tree there. */
function tabStop(): HTMLElement {
  const stop = overlay().querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]');

  if (!stop) throw new Error('The tree has no tab stop.');

  return stop;
}

/** Every leaf in the tab order. The tree has one. */
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

/** The row of the machine list that has focus: its machine id, or else its label. `none` when no row has focus. */
function focusedRow(): string {
  const focused = overlay().activeElement as HTMLElement | null;

  if (!focused?.hasAttribute('data-row')) return 'none';

  return focused.dataset.machine ?? focused.querySelector('[data-part="row-label"]')?.textContent ?? '';
}

async function click(element: Element): Promise<void> {
  fireEvent.click(element);
  await flush();
}

test('Alt+S opens the panel, and closes it again', async () => {
  render(<StateViewer />);
  await flush();

  await press(ALT_S);
  const opened = isOpen();
  await press(ALT_S);
  expect({ opened, closed: isOpen() }).toEqual({ opened: true, closed: false });
});

describe('the shortcut prop', () => {
  test.each([
    ['Alt+S', ALT_S],
    ['shift + ctrl + 1', { key: '1', code: 'Digit1', ctrlKey: true, shiftKey: true }],
    ['cmd+option+esc', { key: 'Escape', code: 'Escape', metaKey: true, altKey: true }],
    ['F2', { key: 'F2', code: 'F2' }],
  ])('takes modifiers in any case and order, and their aliases: %s', async (shortcut, init) => {
    render(<StateViewer shortcut={shortcut} />);
    await flush();

    await press(init);
    expect(isOpen()).toBe(true);
  });

  test('an unknown modifier or a missing key turns the shortcut off, with a warning', async () => {
    const output = watchConsole();
    const { rerender } = render(<StateViewer shortcut="hyper+s" />);
    await flush();
    rerender(<StateViewer shortcut="alt+" />);
    await flush();
    rerender(<StateViewer shortcut="" />);
    await flush();

    await press(ALT_S);
    expect({ open: isOpen(), warnings: output.warn }).toEqual({
      open: false,
      warnings: [
        '[state-viewer] Ignoring the shortcut "hyper+s": expected something like "alt+s".',
        '[state-viewer] Ignoring the shortcut "alt+": expected something like "alt+s".',
        '[state-viewer] Ignoring the shortcut "": expected something like "alt+s".',
      ],
    });
  });

  test('false turns the shortcut off, without a warning', async () => {
    const output = watchConsole();
    render(<StateViewer shortcut={false} />);
    await flush();

    await press(ALT_S);
    expect({ open: isOpen(), warnings: output.warn }).toEqual({ open: false, warnings: [] });
  });

  test('the tooltips of the bubble and the Close button name the shortcut', async () => {
    const tooltips = () => ({
      bubble: control('button[aria-expanded]').title,
      close: control('button[aria-label="Close"]').title,
    });

    const { rerender } = render(<StateViewer defaultOpen />);
    await flush();

    const seen = [tooltips()];
    rerender(<StateViewer defaultOpen shortcut="ctrl+shift+d" />);
    seen.push(tooltips());
    rerender(<StateViewer defaultOpen shortcut={false} />);
    seen.push(tooltips());
    expect(seen).toEqual([
      { bubble: 'State viewer (Alt+S)', close: 'Close (Alt+S)' },
      { bubble: 'State viewer (Ctrl+Shift+D)', close: 'Close (Ctrl+Shift+D)' },
      { bubble: 'State viewer', close: 'Close' },
    ]);
  });
});

describe('focus', () => {
  test('opening with the shortcut puts focus on the tree, and closing gives it back where the shortcut was pressed', async () => {
    const machine = createCheckoutMachine();
    localStorage.setItem('state-viewer:ui', JSON.stringify({ v: 1, machine: machine.id }));
    render(
      <>
        <Run machine={machine} />
        <button type="button">Pay</button>
        <StateViewer />
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

  test('opening on the machine list puts focus on its first row', async () => {
    const machine = createCheckoutMachine();
    render(
      <>
        <Run machine={machine} />
        <StateViewer />
      </>,
    );
    await flush();

    await press(ALT_S);
    expect(focusedRow()).toBe(machine.id);
  });

  test('a row puts focus on the tree of its machine, and Back puts it on that row again', async () => {
    const checkout = createCheckoutMachine();
    const toggle = createToggleMachine();
    render(
      <>
        <Run machine={checkout} />
        <Run machine={toggle} />
        <StateViewer />
      </>,
    );
    await flush();
    await press(ALT_S);
    await press({ key: 'ArrowDown' }, focusedInOverlay());

    await click(focusedInOverlay());
    const opened = { machine: shownMachine(), focus: focusedLeaf() };
    await click(control('button[aria-label="Back"]'));
    expect({ opened, back: focusedRow() }).toEqual({ opened: { machine: toggle.id, focus: 'off' }, back: toggle.id });
  });

  test('Settings puts focus on the checked corner, and Back puts it on the Settings row again', async () => {
    const machine = createCheckoutMachine();
    render(
      <>
        <Run machine={machine} />
        <StateViewer position="bottom-left" />
      </>,
    );
    await flush();
    await press(ALT_S);

    await click(control('[data-row="settings"]'));
    const corner = (overlay().activeElement as HTMLInputElement | null)?.value;
    await click(control('button[aria-label="Back"]'));
    expect({ corner, back: focusedRow() }).toEqual({ corner: 'bottom-left', back: 'Settings' });
  });

  test('a click on another page leaves focus outside the panel where it is', async () => {
    const machine = createCheckoutMachine();
    render(
      <>
        <Run machine={machine} />
        <button type="button">Pay</button>
        <StateViewer defaultOpen />
      </>,
    );
    await flush();
    screen.getByRole('button', { name: 'Pay' }).focus();

    await show(machine.id);
    expect({ machine: shownMachine(), focus: document.activeElement?.textContent }).toEqual({
      machine: machine.id,
      focus: 'Pay',
    });
  });

  test('[ and ] from the tree keep focus in the tree of the machine they show, on its tab stop', async () => {
    const checkout = createCheckoutMachine();
    const toggle = createToggleMachine();
    render(
      <>
        <Run machine={checkout} />
        <Run machine={toggle} />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();
    await show(checkout.id);
    tabStop().focus();

    const seen: { machine: unknown; focus: string }[] = [];

    for (const key of [']', '[']) {
      await press({ key }, overlay().activeElement ?? document.body);
      seen.push({ machine: shownMachine(), focus: focusedLeaf() });
    }

    expect(seen).toEqual([
      { machine: toggle.id, focus: 'off' },
      { machine: checkout.id, focus: 'shipping.standard' },
    ]);
  });
});

describe('in the panel', () => {
  test('arrows, Home and End move through the leaves, Enter previews or releases one, and Escape releases all', async () => {
    const checkout = createCheckoutMachine();
    const toggle = createToggleMachine();
    render(
      <>
        <Run machine={checkout} />
        <Run machine={checkout} />
        <Run machine={toggle} />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();
    await preview(toggle.id, ['on']);
    await show(checkout.id);
    tabStop().focus();

    // The bubble names the number of previews on the page.
    const none = 'State viewer';
    const one = 'State viewer, 1 preview active';
    const two = 'State viewer, 2 previews active';

    const step = (key: string) => ({
      key,
      focus: focusedLeaf(),
      stops: tabStops(),
      previewed: panel().previewed,
      bubble: control('button[aria-expanded]').getAttribute('aria-label'),
    });

    const steps = [step('start')];

    // A control keeps the keys it handles itself: arrows change a select, and Enter clicks a button.
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
      { key: 'start', focus: 'shipping.standard', stops: 'shipping.standard', previewed: [], bubble: one },
      { key: 'ArrowDown', focus: 'shipping.express', stops: 'shipping.express', previewed: [], bubble: one },
      { key: 'ArrowDown', focus: 'payment.editing', stops: 'payment.editing', previewed: [], bubble: one },
      { key: 'ArrowUp', focus: 'shipping.express', stops: 'shipping.express', previewed: [], bubble: one },
      { key: 'ArrowDown on select', focus: 'shipping.express', stops: 'shipping.express', previewed: [], bubble: one },
      { key: 'Enter on button', focus: 'shipping.express', stops: 'shipping.express', previewed: [], bubble: one },
      { key: 'End', focus: 'payment.success', stops: 'payment.success', previewed: [], bubble: one },
      {
        key: 'Enter',
        focus: 'payment.success',
        stops: 'payment.success',
        previewed: ['payment.success'],
        bubble: two,
      },
      { key: 'Enter', focus: 'payment.success', stops: 'payment.success', previewed: [], bubble: one },
      { key: 'Home', focus: 'shipping.standard', stops: 'shipping.standard', previewed: [], bubble: one },
      {
        key: 'Enter',
        focus: 'shipping.standard',
        stops: 'shipping.standard',
        previewed: ['shipping.standard'],
        bubble: two,
      },
      { key: 'Escape', focus: 'shipping.standard', stops: 'shipping.standard', previewed: [], bubble: none },
    ]);
  });

  test('arrows, Home and End skip the leaves of a collapsed state, and the tab stop moves off them', async () => {
    const checkout = createCheckoutMachine();
    render(
      <>
        <Run machine={checkout} />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();
    await show(checkout.id);
    await toggleState('shipping');
    tabStop().focus();

    const seen = [`start: ${focusedLeaf()}`];

    for (const key of ['ArrowUp', 'End', 'ArrowDown', 'Home']) {
      await press({ key }, focusedInOverlay());
      seen.push(`${key}: ${focusedLeaf()}`);
    }

    expect(seen).toEqual([
      // The live shipping leaf is hidden, so the tab stop is on the live payment leaf.
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
    render(
      <>
        <Run machine={checkout} />
        <Run machine={toggle} />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();
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

  test('[ and ] show the previous and next machine, and wrap around', async () => {
    const checkout = createCheckoutMachine();
    const toggle = createToggleMachine();
    const fetcher = createMachine({ id: freshId('fetcher'), initial: 'loading', states: { loading: {}, failed: {} } });

    const parent = setup({ actors: { fetcher } }).createMachine({
      id: freshId('parent'),
      initial: 'active',
      states: { active: { invoke: { id: 'load', src: 'fetcher' } } },
    });

    render(
      <>
        <Run machine={checkout} />
        <Run machine={toggle} />
        <Run machine={parent} />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();
    await show(checkout.id);

    const shown = [shownMachine()];

    for (const key of [']', '[', '[']) {
      await press({ key }, control('[data-instance]'));
      shown.push(shownMachine());
    }

    expect(shown).toEqual([checkout.id, toggle.id, checkout.id, fetcher.id]);
  });
});

describe('matching a key press', () => {
  test('the physical key counts, so Alt+S toggles the panel when it types ß, as on macOS, or S', async () => {
    render(<StateViewer />);
    await flush();

    const open: boolean[] = [];

    for (const key of ['ß', 'S']) {
      await press({ key, code: 'KeyS', altKey: true });
      open.push(isOpen());
    }

    expect(open).toEqual([true, false]);
  });

  test('another modifier or another key does nothing', async () => {
    render(<StateViewer />);
    await flush();

    const open: boolean[] = [];

    for (const init of [
      { key: 's', code: 'KeyS' },
      { key: 's', code: 'KeyS', altKey: true, shiftKey: true },
      { key: 'd', code: 'KeyD', altKey: true },
      ALT_S,
    ]) {
      await press(init);
      open.push(isOpen());
    }

    expect(open).toEqual([false, false, false, true]);
  });
});

describe('typing', () => {
  test('a press in a text field types, so it never toggles the panel', async () => {
    render(
      <>
        <input aria-label="text" />
        <input aria-label="search" type="search" />
        <textarea aria-label="area" />
        <div contentEditable suppressContentEditableWarning>
          <span>inside editable</span>
        </div>
        <input aria-label="box" type="checkbox" />
        <button type="button">button</button>
        <select aria-label="select" />
        <StateViewer />
      </>,
    );
    await flush();

    const toggled: Record<string, boolean> = {};

    const fields = {
      text: screen.getByLabelText('text'),
      search: screen.getByLabelText('search'),
      area: screen.getByLabelText('area'),
      editable: screen.getByText('inside editable'),
      box: screen.getByLabelText('box'),
      button: screen.getByRole('button', { name: 'button' }),
      select: screen.getByLabelText('select'),
    };

    for (const [name, field] of Object.entries(fields)) {
      const before = isOpen();
      await press(ALT_S, field);
      toggled[name] = isOpen() !== before;
    }

    expect(toggled).toEqual({
      text: false,
      search: false,
      area: false,
      editable: false,
      box: true,
      button: true,
      select: true,
    });
  });

  test('a text field inside another shadow root counts as typing', async () => {
    render(<StateViewer />);
    await flush();
    const host = document.createElement('div');
    const input = document.createElement('input');
    const button = document.createElement('button');
    host.attachShadow({ mode: 'open' }).append(input, button);
    document.body.append(host);

    const toggled: Record<string, boolean> = {};

    for (const [name, field] of Object.entries({ input, button })) {
      const before = isOpen();
      await press(ALT_S, field);
      toggled[name] = isOpen() !== before;
    }

    host.remove();
    expect(toggled).toEqual({ input: false, button: true });
  });
});
