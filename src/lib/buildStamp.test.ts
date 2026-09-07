import { describe, expect, it } from 'vitest';
import { BUILD_TIMEZONE, buildStamp } from './buildStamp';

/*
 * The build stamp is only useful if it can be compared to the clock in your
 * pocket without arithmetic, so the offset is the feature — and the offset is
 * not a constant. Melbourne is +11 in January and +10 in July, and a stamp
 * that is an hour out for five months of the year is worse than one that says
 * UTC and admits it.
 */

describe('the build stamp', () => {
  it('reads Melbourne time, not UTC', () => {
    // 11:53 UTC is 21:53 the same evening in Melbourne, in September.
    expect(buildStamp(new Date('2026-09-07T11:53:00Z'))).toBe('2026-09-07 21:53 AEST');
  });

  it('follows daylight saving rather than adding a fixed ten hours', () => {
    // +11 in January, so this one crosses into the next day; +10 in July.
    expect(buildStamp(new Date('2026-01-15T13:00:00Z'))).toBe('2026-01-16 00:00 AEDT');
    expect(buildStamp(new Date('2026-06-30T14:05:00Z'))).toBe('2026-07-01 00:05 AEST');
  });

  it('names the zone, so which half of the year it is remains legible', () => {
    expect(buildStamp(new Date('2026-01-15T13:00:00Z'))).toContain('AEDT');
    expect(buildStamp(new Date('2026-09-07T11:53:00Z'))).toContain('AEST');
  });

  it('writes midnight as 00:00, never 24:00', () => {
    // Some ICU builds render midnight as hour 24 under hour12: false, which is
    // a valid hour nobody reads as midnight.
    expect(buildStamp(new Date('2026-01-15T13:00:00Z'))).toMatch(/ 00:00 /);
  });

  it('sorts as text, because that is how two builds get compared', () => {
    const earlier = buildStamp(new Date('2026-09-07T11:53:00Z'));
    const later = buildStamp(new Date('2026-09-07T12:53:00Z'));
    expect(earlier < later).toBe(true);
  });

  it('is the same instant however it is labelled', () => {
    /* The proof that it is a relabelling and not a shift of the underlying
       time: asked for UTC, the same call gives the UTC reading. */
    const at = new Date('2026-09-07T11:53:00Z');
    expect(buildStamp(at, 'UTC')).toMatch(/^2026-09-07 11:53 /);
    expect(BUILD_TIMEZONE).toBe('Australia/Melbourne');
  });
});
