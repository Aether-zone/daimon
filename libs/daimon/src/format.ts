/**
 * Formatting shared by aether-zone's consoles. Nothing here may import
 * server-only code: client components use this module.
 *
 * akouo and loculus each had their own `formatBytes` and `initials`, and each
 * handled a case the other got wrong — see {@link formatBytes}. This is the
 * union of the two, not a copy of either.
 */

/** Decimal rather than binary, matching what an operating system reports. */
const UNITS = ['B', 'kB', 'MB', 'GB', 'TB'] as const;

/**
 * Bytes, in the unit a person would use.
 *
 * Two things here are easy to lose in a rewrite, and both were bugs in one of
 * the copies this replaces:
 *
 * - **The rollover compares the *rounded* value.** 999_999 B is 999.999 kB,
 *   which renders as "1000 kB" at zero decimals and has to carry into "1.0 MB".
 *   loculus's copy compared the raw value and printed "1000 kB".
 * - **Nothing is assumed about the input.** A negative, a NaN or an Infinity
 *   reaches this from a truncated API response, and akouo's copy rendered them
 *   as "-1 B", "NaN kB" and "Infinity GB".
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '—';
  }

  let value = bytes;
  let unit = 0;

  // Whole bytes are always whole; everything else keeps one decimal until it is
  // big enough not to need one.
  const decimalsFor = (candidate: number, index: number) =>
    index === 0 ? 0 : candidate < 10 ? 1 : 0;

  while (unit < UNITS.length - 1) {
    const rendered = Number(value.toFixed(decimalsFor(value, unit)));

    if (rendered < 1000) {
      break;
    }

    value /= 1000;
    unit += 1;
  }

  return `${value.toFixed(decimalsFor(value, unit))} ${UNITS[unit]}`;
}

/**
 * Up to two initials, for an avatar with no image behind it.
 *
 * Falls back to "?" so an avatar is never a blank circle: a missing name is
 * usually a record still being filled in, not an error worth rendering. Accepts
 * null and undefined for the same reason — a caller holding a half-loaded
 * record should not have to guard before rendering one.
 */
export function initials(name: string | undefined | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return '?';
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
