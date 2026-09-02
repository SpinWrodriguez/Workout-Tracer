/* -------------------------------------------------------------------------- */
/*  Where a dragged row lands.                                               */
/*                                                                           */
/*  Pulled out of the component because it is the only part of a drag with an */
/*  answer that can be checked: given how far a row has moved and how tall    */
/*  its neighbours are, which index does it belong at. The pointer plumbing   */
/*  needs a real browser; this does not.                                     */
/*                                                                           */
/*  Heights matter because these rows are not uniform — an exercise being     */
/*  edited carries two stepper rows and is roughly three times the height of  */
/*  one that is not. Treating them as equal made a long row impossible to     */
/*  drag past and a short one skip two places at once.                       */
/* -------------------------------------------------------------------------- */

/**
 * The index a row should end up at, or `from` when it has not moved far enough
 * to displace anybody.
 *
 * A neighbour is passed once the drag covers half of it: the point where the
 * dragged row's centre has crossed the neighbour's centre, which is when a
 * swap stops being ambiguous.
 */
export function dropIndex(from: number, dy: number, heights: number[]): number {
  if (from < 0 || from >= heights.length) return from;
  let index = from;
  let travelled = 0;

  if (dy > 0) {
    while (index + 1 < heights.length) {
      const next = heights[index + 1] ?? 0;
      if (dy - travelled < next / 2) break;
      travelled += next;
      index += 1;
    }
    return index;
  }

  while (index - 1 >= 0) {
    const previous = heights[index - 1] ?? 0;
    if (-dy - travelled < previous / 2) break;
    travelled += previous;
    index -= 1;
  }
  return index;
}

/** The list with one entry lifted out and put back at another index. */
export function moved<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length) return items;
  const next = [...items];
  const [lifted] = next.splice(from, 1);
  if (lifted === undefined) return items;
  next.splice(Math.max(0, Math.min(to, next.length)), 0, lifted);
  return next;
}
