import type { Intensity } from './weekTemplate';

/* -------------------------------------------------------------------------- */
/*  What a day is, as a colour.                                               */
/*                                                                            */
/*  Every workout used to caption itself "Tue · light" and every tile in the   */
/*  day editor said nothing at all. One line of colour says it on the card, on */
/*  the tile and in the calendar at once, and the words come off.             */
/*                                                                            */
/*  No new hues: heavy is RIR 1's dark red and light is the amber of RIR 3 —   */
/*  the scale this app already uses for hardest to easiest — while golf is the */
/*  blue its chip has always been.                                            */
/*                                                                            */
/*  It was red and green, which is the one pair red-green colour blindness     */
/*  collapses, and both were dark, so they barely separated in greyscale       */
/*  either. Red to amber separates by lightness as well as hue.               */
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

/**
 * What to write on top of one of those fills. Not one colour: the amber is far
 * too bright to take white, which is the same thing that makes it readable
 * beside the red.
 */
export const EFFORT_TEXT: Record<EffortKind, string> = {
  heavy: 'var(--color-effort-text)',
  light: 'var(--color-effort-ink)',
  golf: 'var(--color-effort-text)',
};

/** For anything a screen reader reads, where a colour is not available. */
export const EFFORT_WORD: Record<EffortKind, string> = {
  heavy: 'heavy',
  light: 'light',
  golf: 'golf',
};
