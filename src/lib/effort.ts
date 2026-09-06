import type { Intensity } from './weekTemplate';

/* -------------------------------------------------------------------------- */
/*  What a day is, as a colour.                                               */
/*                                                                            */
/*  Every workout used to caption itself "Tue · light" and every tile in the   */
/*  day editor said nothing at all. One line of colour says it on the card, on */
/*  the tile and in the calendar at once, and the words come off.             */
/*                                                                            */
/*  Red is the same red as RIR 1, blue the same blue the golf chip has always  */
/*  used. Only the green is a new token.                                      */
/*                                                                            */
/*  Colour is never the ONLY thing that says it: the card still names the      */
/*  workout, the calendar chip still carries its short name, and the golf day  */
/*  still reads GOLF. This is a second channel, not the only one.             */
/* -------------------------------------------------------------------------- */

export type EffortKind = Intensity | 'golf';

export const EFFORT_COLOR: Record<EffortKind, string> = {
  heavy: 'var(--color-rir-1)',
  light: 'var(--color-effort-light)',
  golf: 'var(--color-muscle)',
};

/** What to write on top of one of those fills. See the token's own note. */
export const EFFORT_TEXT = 'var(--color-effort-text)';

/** For anything a screen reader reads, where a colour is not available. */
export const EFFORT_WORD: Record<EffortKind, string> = {
  heavy: 'heavy',
  light: 'light',
  golf: 'golf',
};
