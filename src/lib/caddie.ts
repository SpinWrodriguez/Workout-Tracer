/* -------------------------------------------------------------------------- */
/*  The caddie line: ONE deterministic sentence at the top of the Dashboard.   */
/*                                                                            */
/*  It says what a coach would say when you walk in — today's state and the    */
/*  one thing worth knowing next — assembled from the plan, the log and the    */
/*  golf calendar. Never a model, never a paragraph: the whole point is that   */
/*  it can be read in the time it takes the screen to open, every day.         */
/* -------------------------------------------------------------------------- */

export interface CaddieInput {
  /** A round is on today's / tomorrow's date. */
  golfToday: boolean;
  golfTomorrow: boolean;
  /** Name of a session already logged today, newest if there are two. */
  trainedToday?: string;
  /** Today's planned workout, when it exists and is not yet trained. */
  plannedToday?: { name: string; light: boolean };
  /** The next planned day after today, this week. */
  next?: { name: string; weekday: string };
  /** A PR from today's session, pre-phrased ("45 kg bench press, heaviest yet"). */
  pr?: string;
  /** No days are planned in the week at all. */
  weekEmpty: boolean;
}

/** One sentence, or nothing when there is genuinely nothing to say. */
export function caddieLine(input: CaddieInput): string | undefined {
  // Done beats planned: the day's story is what happened. A record is the
  // best thing the line can carry, so it outranks every other clause.
  if (input.trainedToday) {
    return input.pr
      ? `${input.trainedToday} done — ${input.pr}.`
      : `${input.trainedToday} done.`;
  }
  if (input.golfToday) {
    return input.next
      ? `Round today — next session ${input.next.name}, ${input.next.weekday}.`
      : 'Round today.';
  }
  if (input.plannedToday) {
    const clause = input.golfTomorrow
      ? ' — round tomorrow, grip stays light'
      : input.plannedToday.light
        ? ' — light day'
        : '';
    return `${input.plannedToday.name} today${clause}.`;
  }
  if (input.next) return `Rest today — ${input.next.name} on ${input.next.weekday}.`;
  if (input.weekEmpty) return 'Nothing planned this week yet.';
  return undefined;
}
