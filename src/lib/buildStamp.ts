/* -------------------------------------------------------------------------- */
/*  When this build was made, in the timezone it will be read in.             */
/*                                                                           */
/*  The Settings screen prints it so a deployed fix can be told apart from    */
/*  the cached version the service worker is still serving. That only works   */
/*  if the reader can compare it to the clock in their pocket — and it said   */
/*  UTC, which in Melbourne is a subtraction of ten or eleven hours depending */
/*  on the month, done in your head, at the exact moment you are trying to    */
/*  work out whether the thing you just pushed is live.                       */
/*                                                                           */
/*  Nothing in the app imports this: the build id is baked in at compile time */
/*  by vite.config.ts. It lives here so the offset arithmetic can be tested,  */
/*  because the offset is the whole point and it is not a constant.           */
/* -------------------------------------------------------------------------- */

export const BUILD_TIMEZONE = 'Australia/Melbourne';

/**
 * `2026-09-07 21:53 AEST` — ISO-ordered so it sorts, 24-hour so it never needs
 * am/pm, and named so the daylight-saving half of the year is legible rather
 * than an hour out.
 *
 * Intl carries the DST rules, which is why this is not `+10`. Melbourne is
 * AEDT from October to April and AEST the rest of the year, and a hardcoded
 * offset would be wrong for five months of every twelve.
 */
export function buildStamp(at: Date = new Date(), timeZone = BUILD_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    /* h23 rather than hour12: false — some ICU builds render midnight as 24:00
       under the latter, which is a valid hour nobody reads as midnight. */
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).formatToParts(at);

  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? '';

  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')} ${part('timeZoneName')}`;
}
