import { fireEvent, render, screen } from '@testing-library/react';
import { StateViewer } from 'state-viewer';
import { describe, expect, test } from 'vitest';
import { watchConsole } from './support/console';
import { flush, isOpen } from './support/panel';

const ALT_S = { key: 's', code: 'KeyS', altKey: true };

async function press(init: KeyboardEventInit, target: Window | Element = window) {
  fireEvent.keyDown(target, init);
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
    expect({ open: isOpen(), warnings: [...new Set(output.warn)] }).toEqual({
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
