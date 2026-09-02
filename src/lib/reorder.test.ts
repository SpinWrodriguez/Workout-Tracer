import { describe, expect, it } from 'vitest';
import { dropIndex, moved } from './reorder';

/* Rows are not uniform: an exercise being edited is about three times the
   height of one that is not, which is why the maths takes heights at all. */
const EVEN = [60, 60, 60, 60];
const MIXED = [180, 60, 60, 180];

describe('where a dragged row lands', () => {
  it('stays put until the drag covers half a neighbour', () => {
    expect(dropIndex(0, 0, EVEN)).toBe(0);
    expect(dropIndex(0, 29, EVEN)).toBe(0);
    expect(dropIndex(0, 30, EVEN)).toBe(1);
  });

  it('passes a second neighbour only after clearing the first', () => {
    // 60 to clear row 1, then half of row 2.
    expect(dropIndex(0, 89, EVEN)).toBe(1);
    expect(dropIndex(0, 90, EVEN)).toBe(2);
  });

  it('reads a tall neighbour as the tall thing it is', () => {
    /* Row 0 is 180 tall. Dragging row 1 up past it takes 90, not 30 — with
       uniform heights assumed, a long row was impossible to drag past. */
    expect(dropIndex(1, -89, MIXED)).toBe(1);
    expect(dropIndex(1, -90, MIXED)).toBe(0);
  });

  it('does not run off either end', () => {
    expect(dropIndex(0, -500, EVEN)).toBe(0);
    expect(dropIndex(3, 500, EVEN)).toBe(3);
  });

  it('says nothing useful about a row that is not there', () => {
    expect(dropIndex(9, 100, EVEN)).toBe(9);
  });
});

describe('lifting a row out and putting it back', () => {
  it('moves down without losing anybody', () => {
    expect(moved(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves up without losing anybody', () => {
    expect(moved(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('returns the same list when nothing moved', () => {
    const items = ['a', 'b'];
    expect(moved(items, 1, 1)).toBe(items);
  });
});
