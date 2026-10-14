import { describe, expect, test } from 'vitest';
import { eventOrigin, isTyping, matchesShortcut, parseShortcut } from '../../src/overlay/shortcut';

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

describe('parseShortcut', () => {
  test('reads modifiers in any case and order, with aliases', () => {
    expect(parseShortcut('Alt+S')).toEqual({ key: 's', code: 'KeyS', alt: true, ctrl: false, shift: false, meta: false });
    expect(parseShortcut('shift + ctrl + 1')).toEqual({
      key: '1',
      code: 'Digit1',
      alt: false,
      ctrl: true,
      shift: true,
      meta: false,
    });
    expect(parseShortcut('cmd+option+esc')).toEqual({ key: 'escape', alt: true, ctrl: false, shift: false, meta: true });
    expect(parseShortcut('F2')).toMatchObject({ key: 'f2', alt: false });
  });

  test('rejects an unknown modifier or a missing key', () => {
    expect(parseShortcut('hyper+s')).toBeUndefined();
    expect(parseShortcut('alt+')).toBeUndefined();
    expect(parseShortcut('')).toBeUndefined();
  });
});

describe('matchesShortcut', () => {
  const altS = parseShortcut('alt+s')!;

  test('matches the character or the physical key, so macOS Alt+S (ß) still counts', () => {
    expect(matchesShortcut(altS, key({ key: 's', code: 'KeyS', altKey: true }))).toBe(true);
    expect(matchesShortcut(altS, key({ key: 'ß', code: 'KeyS', altKey: true }))).toBe(true);
    expect(matchesShortcut(altS, key({ key: 'S', code: 'KeyS', altKey: true }))).toBe(true);
  });

  test('needs exactly the shortcut’s modifiers', () => {
    expect(matchesShortcut(altS, key({ key: 's', code: 'KeyS' }))).toBe(false);
    expect(matchesShortcut(altS, key({ key: 's', code: 'KeyS', altKey: true, shiftKey: true }))).toBe(false);
    expect(matchesShortcut(altS, key({ key: 'd', code: 'KeyD', altKey: true }))).toBe(false);
  });
});

describe('isTyping', () => {
  test('is true in text inputs, textareas and contenteditable elements', () => {
    document.body.innerHTML = `
      <input id="text"><input id="search" type="search"><input id="box" type="checkbox"><textarea id="area"></textarea>
      <div contenteditable="true"><span id="inside">x</span></div><button id="button">b</button><select id="select"></select>`;
    const byId = (id: string) => document.getElementById(id);

    expect(isTyping(byId('text'))).toBe(true);
    expect(isTyping(byId('search'))).toBe(true);
    expect(isTyping(byId('area'))).toBe(true);
    expect(isTyping(byId('inside'))).toBe(true);
    expect(isTyping(byId('box'))).toBe(false);
    expect(isTyping(byId('button'))).toBe(false);
    expect(isTyping(byId('select'))).toBe(false);
    expect(isTyping(document)).toBe(false);
    expect(isTyping(null)).toBe(false);
    document.body.innerHTML = '';
  });

  test('eventOrigin sees through shadow roots', () => {
    const host = document.createElement('div');
    const input = document.createElement('input');
    host.attachShadow({ mode: 'open' }).append(input);
    document.body.append(host);
    let origin: EventTarget | null = null;
    document.addEventListener('keydown', (event) => (origin = eventOrigin(event)), { once: true });

    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, composed: true }));
    expect(origin).toBe(input);
    host.remove();
  });
});
