import { fireEvent } from '@testing-library/react';
import { flush, overlay } from './panel';

export interface Point {
  x: number;
  y: number;
}

export interface Box extends Point {
  width: number;
  height: number;
}

export interface PointerStep extends Point {
  time: number;
}

const ROOT: Box = { x: 0, y: 0, width: 800, height: 600 };

const SIZE = 32;
const INSET = 16;

const POINTER_ID = 1;

function element(selector: string): HTMLElement {
  const found = overlay().querySelector<HTMLElement>(selector);

  if (!found) throw new Error(`Nothing in the overlay matches ${selector}.`);

  return found;
}

function bubble(): HTMLElement {
  return element('button[aria-expanded]');
}

const laidOut = new WeakSet<Element>();

export function layout(box: Box = ROOT): void {
  const root = element('[data-position]');
  const target = bubble();
  laidOut.add(root);
  root.getBoundingClientRect = () => new DOMRect(box.x, box.y, box.width, box.height);

  target.getBoundingClientRect = () => {
    const corner = root.dataset.position ?? '';
    const [x = 0, y = 0] = target.style.translate.split(' ').map((part) => Number.parseFloat(part) || 0);
    const left = corner.endsWith('left') ? box.x + INSET : box.x + box.width - INSET - SIZE;
    const top = corner.startsWith('top') ? box.y + INSET : box.y + box.height - INSET - SIZE;

    return new DOMRect(left + x, top + y, SIZE, SIZE);
  };
}

function ensureLayout(): void {
  if (!laidOut.has(element('[data-position]'))) layout();
}

export function bubbleAt(): Point {
  ensureLayout();
  const { x, y } = bubble().getBoundingClientRect();

  return { x, y };
}

export function bubbleCenter(box: Box = ROOT): Point {
  return { x: box.x + box.width - INSET - SIZE / 2, y: box.y + box.height - INSET - SIZE / 2 };
}

export function corner(): string | undefined {
  return element('[data-position]').dataset.position;
}

function targetAt(point: Point): Element {
  const target = bubble();

  if (target.hasPointerCapture(POINTER_ID)) return target;
  const { x, y } = bubbleAt();
  const over = point.x >= x && point.x < x + SIZE && point.y >= y && point.y < y + SIZE;

  return over ? target : document.body;
}

function dispatch(type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', step: PointerStep): Element {
  const target = type === 'pointerdown' ? bubble() : targetAt(step);

  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    clientX: step.x,
    clientY: step.y,
    button: type === 'pointermove' ? -1 : 0,
    buttons: type === 'pointerdown' || type === 'pointermove' ? 1 : 0,
  });

  // The constructor takes no time, and the drag reads the speed of the pointer from the times of its events.
  Object.defineProperty(event, 'timeStamp', { value: step.time });
  fireEvent(target, event);

  return target;
}

export function press(step: PointerStep): void {
  ensureLayout();
  dispatch('pointerdown', step);
}

export function move(step: PointerStep): void {
  dispatch('pointermove', step);
}

export async function release(step: PointerStep): Promise<void> {
  const target = dispatch('pointerup', step);
  fireEvent.click(target === bubble() ? target : document.body);
  await flush();
}

export async function cancelPress(step: PointerStep): Promise<void> {
  dispatch('pointercancel', step);
  await flush();
}

export async function drag(steps: readonly PointerStep[]): Promise<{ box: Point; captured: boolean }> {
  const [first, ...rest] = steps;
  const last = rest.at(-1);

  if (!first || !last) throw new Error('A drag needs a press and a release.');
  press(first);

  for (const step of rest.slice(0, -1)) move(step);
  const before = { box: bubbleAt(), captured: bubble().hasPointerCapture(POINTER_ID) };
  await release(last);

  return before;
}

export function stroke(from: Point, to: Point, timing: { moves: number; every: number; hold: number }): PointerStep[] {
  const moves = Array.from({ length: timing.moves }, (_, index) => {
    const part = (index + 1) / timing.moves;

    return { x: from.x + (to.x - from.x) * part, y: from.y + (to.y - from.y) * part, time: timing.every * (index + 1) };
  });

  return [{ ...from, time: 0 }, ...moves, { ...to, time: timing.every * timing.moves + timing.hold }];
}

export const SLOW = { moves: 4, every: 1000, hold: 100 };
