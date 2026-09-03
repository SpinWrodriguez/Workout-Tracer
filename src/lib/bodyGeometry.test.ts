import { describe, expect, it } from 'vitest';
import { MUSCLES } from '../db/seed/muscles';
import type { MuscleId } from '../db/types';
import { BACK_VIEW, FRONT_VIEW, type BodyView } from './bodyGeometry';

/*
 * The geometry is generated from two flat-colour renders, not authored, so
 * these are the invariants a regeneration has to keep. A bad re-trace fails
 * here rather than on the Levels screen — where the symptom would be a muscle
 * that silently stops being shadeable, or a figure scaled off the viewBox.
 */

const VIEWS: [string, BodyView][] = [
  ['front', FRONT_VIEW],
  ['back', BACK_VIEW],
];

/** Every coordinate pair in a subpath. */
function points(path: string): [number, number][] {
  return path
    .replace(/^M/, '')
    .replace(/Z$/, '')
    .split('L')
    .map((pair) => pair.trim().split(/\s+/).map(Number) as [number, number]);
}

describe('what the two views cover', () => {
  it('can shade every muscle the app counts', () => {
    /* The whole point of the flat-colour renders: 18 muscles, 18 shapes. The
       blobs they replaced had one for each too, but the front view drew a
       single shoulder cap and the artwork does the same — so front and side
       delts come from splitting that cap, and this is what proves the split
       happened. */
    const covered = new Set<MuscleId>([
      ...(Object.keys(FRONT_VIEW.muscles) as MuscleId[]),
      ...(Object.keys(BACK_VIEW.muscles) as MuscleId[]),
    ]);
    const missing = MUSCLES.filter((muscle) => !covered.has(muscle.id));
    expect(missing.map((muscle) => muscle.id)).toEqual([]);
  });

  it('puts each muscle on the side of the body it is actually on', () => {
    // Anterior groups on the front only, posterior on the back only.
    for (const id of ['chest', 'abs', 'quads', 'adductors', 'obliques', 'front_delts']) {
      expect(FRONT_VIEW.muscles, id).toHaveProperty(id);
      expect(BACK_VIEW.muscles, id).not.toHaveProperty(id);
    }
    for (const id of ['lats', 'glutes', 'hamstrings', 'triceps', 'lower_back', 'rear_delts']) {
      expect(BACK_VIEW.muscles, id).toHaveProperty(id);
      expect(FRONT_VIEW.muscles, id).not.toHaveProperty(id);
    }
    // Traps, forearms and calves are visible from both, and shade from both.
    for (const id of ['traps', 'forearms', 'calves']) {
      expect(FRONT_VIEW.muscles, id).toHaveProperty(id);
      expect(BACK_VIEW.muscles, id).toHaveProperty(id);
    }
  });

  it('names nothing the app does not have a muscle for', () => {
    const known = new Set(MUSCLES.map((muscle) => muscle.id as string));
    for (const [side, view] of VIEWS) {
      for (const id of Object.keys(view.muscles)) {
        expect(known.has(id), `${side}/${id}`).toBe(true);
      }
    }
  });
});

describe('the shapes themselves', () => {
  it('are closed polygons, which is what makes them fillable', () => {
    for (const [side, view] of VIEWS) {
      for (const path of [...view.body, ...Object.values(view.muscles).flat()]) {
        expect(path.startsWith('M'), side).toBe(true);
        expect(path.endsWith('Z'), side).toBe(true);
        expect(points(path).length, `${side}: ${path.slice(0, 24)}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('sit inside the viewBox they declare', () => {
    /* A re-trace at the wrong scale is the failure this catches: the figure
       renders half off the card, which looks like a layout bug three files
       away from the cause. */
    for (const [side, view] of VIEWS) {
      for (const path of [...view.body, ...Object.values(view.muscles).flat()]) {
        for (const [x, y] of points(path)) {
          expect(Number.isFinite(x) && Number.isFinite(y), side).toBe(true);
          expect(x, `${side} x`).toBeGreaterThanOrEqual(-1);
          expect(x, `${side} x`).toBeLessThanOrEqual(view.width + 1);
          expect(y, `${side} y`).toBeGreaterThanOrEqual(-1);
          expect(y, `${side} y`).toBeLessThanOrEqual(view.height + 1);
        }
      }
    }
  });

  it('come in pairs, because muscles do', () => {
    // Everything but the midline groups is traced twice, left and right.
    const midline = new Set(['abs', 'traps', 'lower_back', 'upper_back']);
    for (const [side, view] of VIEWS) {
      for (const [id, subpaths] of Object.entries(view.muscles)) {
        if (midline.has(id)) continue;
        expect(subpaths?.length, `${side}/${id}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('draw the two figures at one scale, so they can be read against each other', () => {
    expect(FRONT_VIEW.height).toBe(BACK_VIEW.height);
    // Same person: the widths agree to within a few percent.
    expect(Math.abs(FRONT_VIEW.width - BACK_VIEW.width)).toBeLessThan(FRONT_VIEW.width * 0.05);
  });

  it('stay small enough to ship in the bundle', () => {
    /* It replaced ~4KB of blobs. Twenty KB of real anatomy is a good trade;
       two hundred, from a trace nobody simplified, would not be. */
    const bytes = JSON.stringify([FRONT_VIEW, BACK_VIEW]).length;
    expect(bytes).toBeLessThan(40_000);
  });
});
