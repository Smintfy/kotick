import { fireEvent, render, type RenderResult } from '@testing-library/react';
import { Kotick } from 'kotick';
import { describe, expect, onTestFinished, test } from 'vitest';
import { bubbleAt, bubbleCenter, cancelPress, corner, drag, layout, move, press, release, SLOW, stroke } from './support/drag';
import type { Json } from './support/json';
import { flush, isOpen, overlay } from './support/panel';

const START = bubbleCenter();
const FRAME = { x: 100, y: 50, width: 400, height: 300 };

function stored(): Json {
  const raw = localStorage.getItem('kotick:ui');

  return raw === null ? null : JSON.parse(raw);
}

function seen() {
  return { corner: corner(), box: bubbleAt(), open: isOpen(), stored: stored() };
}

async function clickBubble(): Promise<void> {
  const bubble = overlay().querySelector('button[aria-expanded]');

  if (!bubble) throw new Error('The overlay has no bubble.');
  fireEvent.click(bubble);
  await flush();
}

test('a drag moves the bubble to the corner near its release, and the panel opens there after a reload', async () => {
  const { unmount } = render(<Kotick />);
  await flush();

  const during = await drag(stroke(START, { x: 60, y: 60 }, SLOW));
  const after = seen();
  unmount();
  render(<Kotick />);
  await flush();
  await clickBubble();

  expect({ during, after, reloaded: seen() }).toEqual({
    during: { box: { x: 44, y: 44 }, captured: true },
    after: {
      corner: 'top-left',
      box: { x: 16, y: 16 },
      open: false,
      stored: { v: 1, position: 'top-left', positionDefault: 'bottom-right' },
    },
    reloaded: {
      corner: 'top-left',
      box: { x: 16, y: 16 },
      open: true,
      stored: { v: 1, position: 'top-left', positionDefault: 'bottom-right', open: true },
    },
  });
});

describe('a press that moves a little', () => {
  test.each([
    {
      moved: '3px right and 3px down, 4.2px',
      to: { x: 771, y: 571 },
      expected: { corner: 'bottom-right', box: { x: 752, y: 552 }, open: true, stored: { v: 1, open: true } },
    },
    {
      moved: '3px right and 4px down, 5px',
      to: { x: 771, y: 572 },
      expected: { corner: 'bottom-right', box: { x: 752, y: 552 }, open: false, stored: null },
    },
  ])('opens the panel below 5px and drags from 5px: $moved', async ({ to, expected }) => {
    render(<Kotick />);
    await flush();
    await drag(stroke(START, to, { moves: 1, every: 100, hold: 100 }));

    expect(seen()).toEqual(expected);
  });
});

describe('the speed at the release', () => {
  test.each([
    {
      speed: 'a fast flick goes on to the corner it points at',
      timing: { moves: 4, every: 16, hold: 4 },
      expected: {
        corner: 'top-right',
        box: { x: 752, y: 16 },
        open: false,
        stored: { v: 1, position: 'top-right', positionDefault: 'bottom-right' },
      },
    },
    {
      speed: 'a fast flick with a move every 8ms, as on a 120Hz screen, goes on to the corner it points at',
      timing: { moves: 8, every: 8, hold: 4 },
      expected: {
        corner: 'top-right',
        box: { x: 752, y: 16 },
        open: false,
        stored: { v: 1, position: 'top-right', positionDefault: 'bottom-right' },
      },
    },
    {
      speed: 'a slow drag goes back to its corner, and stores nothing',
      timing: SLOW,
      expected: { corner: 'bottom-right', box: { x: 752, y: 552 }, open: false, stored: null },
    },
    {
      speed: 'a fast drag that stops 200ms before the release goes back to its corner',
      timing: { moves: 4, every: 16, hold: 200 },
      expected: { corner: 'bottom-right', box: { x: 752, y: 552 }, open: false, stored: null },
    },
  ])('$speed', async ({ timing, expected }) => {
    render(<Kotick />);
    await flush();
    const during = await drag(stroke(START, { x: 768, y: 388 }, timing));

    expect({ during: during.box, ...seen() }).toEqual({ during: { x: 752, y: 372 }, ...expected });
  });
});

describe('in a frame smaller than the window, such as a portal target', () => {
  test.each([
    {
      toward: 'the top left',
      to: { x: 0, y: 0 },
      expected: { during: { x: 100, y: 50 }, corner: 'top-left', box: { x: 116, y: 66 } },
    },
    {
      toward: 'the bottom right',
      to: { x: 1000, y: 1000 },
      expected: { during: { x: 468, y: 318 }, corner: 'bottom-right', box: { x: 452, y: 302 } },
    },
  ])('a drag past the edge toward $toward keeps the bubble in the frame, and ends in a corner of it', async ({ to, expected }) => {
    render(<Kotick />);
    await flush();
    layout(FRAME);
    const during = await drag(stroke(bubbleCenter(FRAME), to, SLOW));

    expect({ during: during.box, corner: corner(), box: bubbleAt() }).toEqual(expected);
  });
});

test('while the panel is open, a drag leaves the bubble in its corner, and the panel stays open', async () => {
  render(<Kotick defaultOpen />);
  await flush();
  const during = await drag(stroke(START, { x: 60, y: 60 }, SLOW));

  expect({ during, ...seen() }).toEqual({
    during: { box: { x: 752, y: 552 }, captured: false },
    corner: 'bottom-right',
    box: { x: 752, y: 552 },
    open: true,
    stored: null,
  });
});

describe('a cancelled drag', () => {
  test.each([
    {
      cancel: 'Escape',
      end: async () => {
        fireEvent.keyDown(window, { key: 'Escape' });
        await release({ ...START, time: 1000 });
      },
      expected: { open: false, stored: null },
    },
    {
      cancel: 'a pointercancel',
      end: () => cancelPress({ x: 200, y: 150, time: 1000 }),
      expected: { open: false, stored: null },
    },
    {
      cancel: 'the shortcut, which opens the panel',
      end: async () => {
        fireEvent.keyDown(window, { key: 's', code: 'KeyS', altKey: true });
        await release({ ...START, time: 1000 });
      },
      expected: { open: true, stored: { v: 1, open: true } },
    },
  ])('$cancel sends the bubble back to its corner, and stores no corner', async ({ end, expected }) => {
    render(<Kotick />);
    await flush();
    press({ ...START, time: 0 });
    move({ x: 200, y: 150, time: 500 });
    await end();

    expect(seen()).toEqual({ corner: 'bottom-right', box: { x: 752, y: 552 }, ...expected });
  });

  test('after Escape and a release away from the bubble, the next click on the bubble opens the panel', async () => {
    render(<Kotick />);
    await flush();
    press({ ...START, time: 0 });
    move({ x: 200, y: 150, time: 500 });
    fireEvent.keyDown(window, { key: 'Escape' });
    await release({ x: 200, y: 150, time: 1000 });
    await drag([
      { ...START, time: 2000 },
      { ...START, time: 2100 },
    ]);

    expect(seen()).toEqual({
      corner: 'bottom-right',
      box: { x: 752, y: 552 },
      open: true,
      stored: { v: 1, open: true },
    });
  });
});

describe('the page under the drag', () => {
  test.each([
    { ending: 'the release', end: () => release({ x: 400, y: 300, time: 1000 }) },
    { ending: 'an unmount of the overlay', end: async (view: RenderResult) => view.unmount() },
  ])('gets no text selection and no drag of its links until $ending, and no style', async ({ end }) => {
    const link = document.createElement('a');
    link.href = '/checkout';
    link.textContent = 'Checkout';
    document.body.append(link);
    onTestFinished(() => link.remove());
    const view = render(<Kotick />);
    await flush();

    const allowed = () => ({
      select: link.dispatchEvent(new Event('selectstart', { bubbles: true, cancelable: true })),
      drag: link.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true })),
    });

    press({ ...START, time: 0 });
    move({ x: 400, y: 300, time: 500 });
    const during = allowed();
    await end(view);

    expect({
      during,
      after: allowed(),
      styles: [document.documentElement.getAttribute('style'), document.body.getAttribute('style')],
    }).toEqual({ during: { select: false, drag: false }, after: { select: true, drag: true }, styles: [null, null] });
  });
});
