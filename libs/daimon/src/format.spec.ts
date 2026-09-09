import { describe, expect, it } from 'vitest';

import { formatBytes, initials } from './format.js';

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [999, '999 B'],
    [1000, '1.0 kB'],
    [1500, '1.5 kB'],
    [1048576, '1.0 MB'],
    [5_000_000_000, '5.0 GB'],
  ])('renders %i as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  /*
   * Each of these was wrong in one of the two copies this replaces. They are
   * the reason the merge is not simply either one of them.
   */
  describe('the edges each copy got wrong', () => {
    it.each([
      // loculus compared the raw value when deciding to carry, so 999.999 kB
      // rendered at zero decimals as "1000 kB" instead of rolling over.
      [999_999, '1.0 MB'],
      [999_949, '1.0 MB'],
    ])('carries %i into the next unit', (bytes, expected) => {
      expect(formatBytes(bytes)).toBe(expected);
    });

    it('goes past GB, which akouo capped at', () => {
      expect(formatBytes(5_000_000_000_000)).toBe('5.0 TB');
    });

    it.each([
      [-1, 'a negative size'],
      [Number.NaN, 'a NaN'],
      [Number.POSITIVE_INFINITY, 'an infinity'],
    ])('renders %p as a dash — %s', (bytes) => {
      // akouo's copy rendered these as "-1 B", "NaN kB" and "Infinity GB".
      expect(formatBytes(bytes)).toBe('—');
    });
  });

  it('drops the decimal at ten and above, and keeps it below', () => {
    expect(formatBytes(15_000)).toBe('15 kB');
    expect(formatBytes(9_900)).toBe('9.9 kB');
  });

  it('never gives whole bytes a decimal', () => {
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(999)).toBe('999 B');
  });

  it('stops at the largest unit rather than inventing one', () => {
    expect(formatBytes(5e15)).toBe('5000 TB');
  });
});

describe('initials', () => {
  it.each([
    ['Ada Lovelace', 'AL'],
    ['ada lovelace', 'AL'],
    ['Ada', 'A'],
    ['Ada Byron King Lovelace', 'AB'],
    ['  Ada   Lovelace  ', 'AL'],
  ])('reduces %p to %p', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });

  it.each<[string | null | undefined, string]>([
    [undefined, 'undefined'],
    [null, 'null'],
    ['', 'an empty string'],
    ['   ', 'only whitespace'],
  ])('falls back to a question mark for %p — %s', (name) => {
    // An avatar is never a blank circle: a missing name is usually a record
    // still being filled in, not an error worth rendering.
    expect(initials(name)).toBe('?');
  });
});
