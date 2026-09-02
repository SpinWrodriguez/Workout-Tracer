/* -------------------------------------------------------------------------- */
/*  Illustrations for the movements nothing upstream has.                     */
/*                                                                           */
/*  Eleven exercises have no record in free-exercise-db, so no photo comes    */
/*  with them and none can be borrowed: an audit of all 876 upstream records  */
/*  found either nothing or a different movement wearing a similar name, and  */
/*  the only licensable stock for them is watermarked or share-alike.         */
/*                                                                           */
/*  These are ours. Two frames each — the start and the finish, the same      */
/*  convention upstream uses — sized down from the originals by              */
/*  scripts/photos-optimise.mjs, which is where to look when the artwork      */
/*  changes. 361 KB for the set, against 26 MB of sources.                    */
/*                                                                           */
/*  Served from public/ rather than imported, so the filename is the contract */
/*  and adding a pair for a twelfth exercise is a file drop plus one line     */
/*  here. BASE_URL because GitHub Pages serves this from a subpath.           */
/* -------------------------------------------------------------------------- */

/** Exercises with illustrations of their own, in the order the frames go. */
export const ILLUSTRATED: string[] = [
  'bw_neutral_pull_up',
  'bw_side_plank_reach',
  'cb_punch',
  'cb_rotational_row',
  'kb_bulgarian_split',
  'kb_overhead_carry',
  'lm_rotational_press',
  'lm_scoop',
  'lm_squat_to_press',
  'mb_90_90',
  'mb_open_book',
];

const set = new Set(ILLUSTRATED);

/**
 * The two frames for an exercise, or nothing. Nothing is the normal case:
 * most exercises resolve to an upstream reference photo instead.
 */
export function photosFor(exerciseId: string): string[] {
  if (!set.has(exerciseId)) return [];
  const base = import.meta.env.BASE_URL;
  return [1, 2].map((frame) => `${base}exercise-photos/${exerciseId}-${frame}.webp`);
}
