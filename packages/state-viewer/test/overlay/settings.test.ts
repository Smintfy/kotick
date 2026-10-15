import { beforeEach, describe, expect, test } from 'vitest';
import { readSettings, writeSettings } from '../../src/overlay/settings';

beforeEach(() => {
  localStorage.clear();
});

describe('readSettings and writeSettings', () => {
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
