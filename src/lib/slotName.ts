import type { DaySlot } from '../db/types';

/* -------------------------------------------------------------------------- */
/*  What a day is called.                                                     */
/*                                                                            */
/*  "Day A" is a spreadsheet column, not a session. The NATO word for the same */
/*  letter reads as a name while staying obviously the same thing — Alpha IS   */
/*  A, so the one-character pill in the week strip needs no second vocabulary. */
/*                                                                            */
/*  Deliberately NOT baked into the name: intensity. A slot keeps its identity */
/*  across regenerations, and heavy/light is a property of this week's plan —  */
/*  fold it in and "I squatted 100 on Heavy Alpha" stops matching a history    */
/*  row the moment that day is regenerated light. It rides alongside instead.  */
/*                                                                            */
/*  Slots are storage keys: the DaySlot union stays A/B/C/X/Y and nothing in   */
/*  the database moves. This is a display mapping and only a display mapping.  */
/* -------------------------------------------------------------------------- */

export const SLOT_NAME: Record<DaySlot, string> = {
  A: 'Alpha',
  B: 'Bravo',
  C: 'Charlie',
  X: 'X-ray',
  Y: 'Yankee',
};

/** The display name for a slot. Unknown slots fall back to their own key so a
    stale session row renders as itself rather than "undefined". */
export function slotName(slot: DaySlot | string | undefined): string {
  if (slot === undefined) return '';
  return SLOT_NAME[slot as DaySlot] ?? slot;
}
