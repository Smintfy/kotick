import { beforeEach, describe, expect, test } from 'vitest';
import {
  SETTINGS_KEY,
  nextPosition,
  readSettings,
  resolvePosition,
  writeSettings,
} from '../../src/overlay/settings';

beforeEach(() => {
  localStorage.clear();
});

describe('readSettings and writeSettings', () => {
  test('round-trip through localStorage', () => {
    writeSettings({ open: true, position: 'top-left', positionDefault: 'bottom-right', machine: 'checkout' });
    expect(readSettings()).toEqual({
      open: true,
      position: 'top-left',
      positionDefault: 'bottom-right',
      machine: 'checkout',
    });
  });

  test('leave out invalid fields, and ignore other versions and broken JSON', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ v: 1, open: 'yes', position: 'middle', machine: '' }));
    expect(readSettings()).toEqual({});
    // A position without the default it was chosen over can't be applied.
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ v: 1, position: 'top-left' }));
    expect(readSettings()).toEqual({});
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ v: 2, open: true }));
    expect(readSettings()).toEqual({});
    localStorage.setItem(SETTINGS_KEY, '{');
    expect(readSettings()).toEqual({});
  });

  test('cope with storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    } as unknown as Storage;
    expect(readSettings(broken)).toEqual({});
    expect(() => writeSettings({ open: true }, broken)).not.toThrow();
    expect(readSettings(null)).toEqual({});
  });
});

test('resolvePosition applies the stored corner only while the prop is the one it was chosen over', () => {
  const settings = { position: 'top-left', positionDefault: 'bottom-right' } as const;
  expect(resolvePosition(settings, 'bottom-right')).toBe('top-left');
  expect(resolvePosition(settings, 'bottom-left')).toBe('bottom-left');
  expect(resolvePosition({}, 'top-right')).toBe('top-right');
});

test('nextPosition goes clockwise', () => {
  expect(nextPosition('top-left')).toBe('top-right');
  expect(nextPosition('top-right')).toBe('bottom-right');
  expect(nextPosition('bottom-right')).toBe('bottom-left');
  expect(nextPosition('bottom-left')).toBe('top-left');
});
