import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type AnimationEvent,
  type RefObject,
} from 'react';
import { flushSync } from 'react-dom';
import { useIsomorphicLayoutEffect } from '../shared-hooks/use-isomorphic-layout-effect';
import type { Position } from '../types';
import {
  addSample,
  clamp,
  measureBounds,
  snapCorner,
  type Bounds,
  type Point,
  type Sample,
} from '../utils/snap';
import { useLatest } from './use-latest';

const DRAG_THRESHOLD = 5;

const MAX_OVERSHOOT_PX = 3;

const OVERSHOOT_FRACTION = 0.04;

interface Press {
  kind: 'pressed';
  pointerId: number;
  start: Point;
  bubble: HTMLElement;
  root: HTMLElement;
  listeners: AbortController;
}

interface Drag extends Omit<Press, 'kind'> {
  kind: 'dragging';
  bounds: Bounds;
  origin: Point;
  at: Point;
  samples: readonly Sample[];
}

type Gesture = { kind: 'idle' } | Press | Drag | { kind: 'swallowing-click' };

interface BubbleDragOptions {
  rootRef: RefObject<HTMLElement | null>;
  position: Position;
  enabled: boolean;
  onMove(position: Position): void;
}

export function useBubbleDrag({ rootRef, position, enabled, onMove }: BubbleDragOptions) {
  const gesture = useRef<Gesture>({ kind: 'idle' });
  const latest = useLatest({ position, onMove });

  useIsomorphicLayoutEffect(() => {
    if (!enabled) cancel();
  }, [enabled]);

  useEffect(
    () => () => {
      const current = gesture.current;

      if (isActive(current)) end(current, 'idle');
    },
    [],
  );

  function onPointerDown(event: ReactPointerEvent<HTMLElement>): void {
    const current = gesture.current;

    if (current.kind === 'dragging') return;

    // A press can lose its pointerup, such as over a frame before the capture, so a new press replaces it.
    if (current.kind === 'pressed') end(current, 'idle');
    gesture.current = { kind: 'idle' };
    const root = rootRef.current;

    if (!enabled || event.button !== 0 || !root) return;
    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    window.addEventListener('pointermove', onPointerMove, options);
    window.addEventListener('pointerup', onPointerUp, options);
    window.addEventListener('pointercancel', onPointerCancel, options);
    window.addEventListener('keydown', onKeyDown, options);
    window.addEventListener('selectstart', preventDefault, options);
    // The bubble moves away from the press, so the browser would drag a link or an image under the press point.
    window.addEventListener('dragstart', preventDefault, options);

    gesture.current = {
      kind: 'pressed',
      pointerId: event.pointerId,
      start: pointOf(event),
      bubble: event.currentTarget,
      root,
      listeners,
    };
  }

  function onPointerMove(event: PointerEvent): void {
    const current = gesture.current;

    if (!isTracked(current, event)) return;
    const pointer = pointOf(event);

    if (current.kind === 'pressed' && distance(pointer, current.start) < DRAG_THRESHOLD) return;
    const drag = current.kind === 'pressed' ? startDrag(current) : current;
    const moved = { x: drag.origin.x + pointer.x - drag.start.x, y: drag.origin.y + pointer.y - drag.start.y };
    const at = clamp(drag.bounds, moved);
    setOffsetFromSlot(drag.bubble, at, drag.bounds.slots[latest.current.position]);
    gesture.current = { ...drag, at, samples: addSample(drag.samples, { ...pointer, time: event.timeStamp }) };
  }

  function onPointerUp(event: PointerEvent): void {
    const current = gesture.current;

    if (!isTracked(current, event)) return;

    if (current.kind === 'pressed') end(current, 'idle');
    else settle(current, snapCorner(current.bounds, current.at, current.samples, event.timeStamp));
  }

  function onPointerCancel(event: PointerEvent): void {
    if (isTracked(gesture.current, event)) cancel();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || gesture.current.kind !== 'dragging') return;
    event.preventDefault();
    cancel();
  }

  function startDrag(press: Press): Drag {
    const { bubble, root } = press;
    const origin = stopGlide(bubble);
    const bounds = measureBounds(root.getBoundingClientRect(), bubble.getBoundingClientRect(), latest.current.position);
    // Without the capture, the drag stops when the pointer goes over a frame.
    bubble.setPointerCapture(press.pointerId);
    bubble.dataset.dragging = '';

    return { ...press, kind: 'dragging', bounds, origin, at: origin, samples: [] };
  }

  function cancel(): void {
    const current = gesture.current;

    if (current.kind === 'pressed') end(current, 'idle');

    if (current.kind === 'dragging') settle(current, latest.current.position);
  }

  function settle(drag: Drag, corner: Position): void {
    end(drag, 'swallowing-click');

    if (corner !== latest.current.position) flushSync(() => latest.current.onMove(corner));
    glide(drag.bubble, drag.at, drag.bounds.slots[corner]);
  }

  function end(current: Press | Drag, next: 'idle' | 'swallowing-click'): void {
    current.listeners.abort();

    if (current.kind === 'dragging') {
      if (current.bubble.hasPointerCapture(current.pointerId)) current.bubble.releasePointerCapture(current.pointerId);
      delete current.bubble.dataset.dragging;
    }

    gesture.current = { kind: next };
  }

  function onAnimationEnd(event: AnimationEvent<HTMLElement>): void {
    if (event.target === event.currentTarget && event.animationName === 'kotick-glide') clearGlide(event.currentTarget);
  }

  function clickEndsDrag(): boolean {
    if (gesture.current.kind !== 'swallowing-click') return false;
    gesture.current = { kind: 'idle' };

    return true;
  }

  return { onPointerDown, onAnimationEnd, clickEndsDrag };
}

function isActive(gesture: Gesture): gesture is Press | Drag {
  return gesture.kind === 'pressed' || gesture.kind === 'dragging';
}

function isTracked(gesture: Gesture, event: PointerEvent): gesture is Press | Drag {
  return isActive(gesture) && gesture.pointerId === event.pointerId;
}

function pointOf(event: Pick<PointerEvent, 'clientX' | 'clientY'>): Point {
  return { x: event.clientX, y: event.clientY };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function preventDefault(event: Event): void {
  event.preventDefault();
}

function setOffsetFromSlot(bubble: HTMLElement, at: Point, slot: Point): void {
  bubble.style.translate = `${at.x - slot.x}px ${at.y - slot.y}px`;
}

function glide(bubble: HTMLElement, from: Point, slot: Point): void {
  const x = from.x - slot.x;
  const y = from.y - slot.y;
  const length = Math.hypot(x, y);
  const past = length === 0 ? 0 : Math.min(MAX_OVERSHOOT_PX / length, OVERSHOOT_FRACTION);
  bubble.style.setProperty('--kotick-glide-from', `${x}px ${y}px`);
  bubble.style.setProperty('--kotick-glide-past', `${-x * past}px ${-y * past}px`);
  bubble.style.removeProperty('translate');
  bubble.dataset.glide = '';
}

function stopGlide(bubble: HTMLElement): Point {
  const { x, y } = bubble.getBoundingClientRect();
  clearGlide(bubble);

  return { x, y };
}

function clearGlide(bubble: HTMLElement): void {
  delete bubble.dataset.glide;
  bubble.style.removeProperty('translate');
  bubble.style.removeProperty('--kotick-glide-from');
  bubble.style.removeProperty('--kotick-glide-past');
}
