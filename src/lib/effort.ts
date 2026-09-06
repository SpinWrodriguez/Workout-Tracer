import type { Intensity } from './weekTemplate';

/* -------------------------------------------------------------------------- */
/*  What a day is, as a colour.                                               */
/*                                                                            */
/*  Every workout used to caption itself "Tue · light" and every tile in the   */
/*  day editor said nothing at all. One line of colour says it on the card, on */
/*  the tile and in the calendar at once, and the words come off.             */
/*                                                                            */
/*  The three are the ones the dashboard rings already use — volume, strength, */
/*  muscle — chosen from there because that is the one screen where all three  */
/*  sit side by side, and the place they were reported as telling apart.       */
/*                                                                            */
/*  This started as red and green, which is the pair red-green colour          */
/*  blindness collapses. Rust and teal is a yellow-blue pair instead, and      */
/*  blue-yellow is the axis that survives: simulated deuteranopia separates    */
/*  them by about 180 on it, where red and green managed 90 and came out as    */
/*  two olives.                                                                */
/*                                                                            */
/*  Colour is never the ONLY thing that says it: the card names the workout,   */
/*  the calendar chip carries its short name, the golf day reads GOLF, and     */
/*  every label a screen reader gets spells the effort out.                    */
/* -------------------------------------------------------------------------- */

export type EffortKind = Intensity | 'golf';

export const EFFORT_COLOR: Record<EffortKind, string> = {
  heavy: 'var(--color-volume)',
  light: 'var(--color-strength)',
  golf: 'var(--color-muscle)',
};

/**
 * What to write on top of one of those fills. One ink per fill rather than one
 * for all three: in dark, two of them are bright enough to need near-black
 * while the blue needs white. See the tokens' own note.
 */
export const EFFORT_TEXT: Record<EffortKind, string> = {
  heavy: 'var(--color-effort-ink-heavy)',
  light: 'var(--color-effort-ink-light)',
  golf: 'var(--color-effort-ink-golf)',
};

/** For anything a screen reader reads, where a colour is not available. */
export const EFFORT_WORD: Record<EffortKind, string> = {
  heavy: 'heavy',
  light: 'light',
  golf: 'golf',
};
