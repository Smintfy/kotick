import type { Position } from '../types';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export type Box = Point & Size;

export interface Sample extends Point {
  time: number;
}

export interface Bounds {
  root: Box;
  size: Size;
  slots: Record<Position, Point>;
}

const CORNERS: readonly Position[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

const SAMPLE_COUNT = 6;
const SAMPLE_GAP_MS = 10;

const SPEED_WINDOW_MS = 100;

const SPEED_KEPT_PER_MS = 0.999;

function isLeft(corner: Position): boolean {
  return corner.endsWith('left');
}

function isTop(corner: Position): boolean {
  return corner.startsWith('top');
}

export function measureBounds(root: Box, bubble: Box, corner: Position): Bounds {
  const insetX = isLeft(corner) ? bubble.x - root.x : root.x + root.width - bubble.x - bubble.width;
  const insetY = isTop(corner) ? bubble.y - root.y : root.y + root.height - bubble.y - bubble.height;
  const left = root.x + insetX;
  const right = root.x + root.width - insetX - bubble.width;
  const top = root.y + insetY;
  const bottom = root.y + root.height - insetY - bubble.height;

  return {
    root,
    size: { width: bubble.width, height: bubble.height },
    slots: {
      'top-left': { x: left, y: top },
      'top-right': { x: right, y: top },
      'bottom-left': { x: left, y: bottom },
      'bottom-right': { x: right, y: bottom },
    },
  };
}

export function clamp(bounds: Bounds, point: Point): Point {
  const { root, size } = bounds;

  return {
    x: Math.min(Math.max(point.x, root.x), root.x + root.width - size.width),
    y: Math.min(Math.max(point.y, root.y), root.y + root.height - size.height),
  };
}

export function addSample(samples: readonly Sample[], sample: Sample): readonly Sample[] {
  const last = samples.at(-1);

  if (last && sample.time - last.time < SAMPLE_GAP_MS) return samples;

  return [...samples.slice(1 - SAMPLE_COUNT), sample];
}

function velocity(samples: readonly Sample[], time: number): Point {
  const recent = samples.filter((sample) => time - sample.time <= SPEED_WINDOW_MS);
  const first = recent[0];
  const last = recent.at(-1);

  if (!first || !last || first === last) return { x: 0, y: 0 };
  const seconds = (last.time - first.time) / 1000;

  return { x: (last.x - first.x) / seconds, y: (last.y - first.y) / seconds };
}

function slideDistance(pxPerSecond: number): number {
  return ((pxPerSecond / 1000) * SPEED_KEPT_PER_MS) / (1 - SPEED_KEPT_PER_MS);
}

export function snapCorner(bounds: Bounds, at: Point, samples: readonly Sample[], time: number): Position {
  const speed = velocity(samples, time);
  const target = { x: at.x + slideDistance(speed.x), y: at.y + slideDistance(speed.y) };

  const distanceTo = (corner: Position) =>
    Math.hypot(bounds.slots[corner].x - target.x, bounds.slots[corner].y - target.y);

  return CORNERS.reduce((nearest, corner) => (distanceTo(corner) < distanceTo(nearest) ? corner : nearest));
}
