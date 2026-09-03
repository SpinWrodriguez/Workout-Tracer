// @vitest-environment jsdom

/*
 * The body heat map, driven through what a reader can actually perceive: the
 * fill on each muscle and the text beside it. Nothing here asserts on a path's
 * geometry — bodyGeometry.test.ts owns that — because the bug this file exists
 * to catch is a muscle whose colour stops following its sets.
 */

import '../test/dom';

import { describe, expect, it } from 'vitest';
import { draw } from '../test/dom';
import { MUSCLES } from '../db/seed/muscles';
import type { MuscleId } from '../db/types';
import { HEAT_FULL, VOLUME_HIGH, VOLUME_LOW, type MuscleVolume } from '../lib/volume';
import { Silhouette } from './Silhouette';

/** A volume record with everything at zero except what a test names. */
function volumeOf(sets: Partial<Record<MuscleId, number>>): MuscleVolume {
  return Object.fromEntries(
    MUSCLES.map((muscle) => [muscle.id, sets[muscle.id] ?? 0]),
  ) as MuscleVolume;
}

const render = (sets: Partial<Record<MuscleId, number>>) => draw(<Silhouette volume={volumeOf(sets)} />);

/** The shape a muscle is drawn as, found by the id the seed reserved for it. */
const shapeFor = (view: HTMLElement, id: MuscleId): SVGPathElement => {
  const path = view.querySelector<SVGPathElement>(`#${MUSCLES.find((m) => m.id === id)?.svgPathId}`);
  if (!path) throw new Error(`no shape drawn for ${id}`);
  return path;
};

describe('what the colour says', () => {
  it('leaves an untrained muscle at the card grey, with no volume mixed in', () => {
    const { container } = render({ chest: 0 });
    expect(shapeFor(container, 'chest').getAttribute('fill')).toBe('var(--color-surface-2)');
  });

  it('warms a muscle in proportion to the sets it got', () => {
    /* The ramp is one hue mixed toward the surface, so the percentage IS the
       reading. Half a full week has to land visibly short of a full one, or
       the map cannot tell "a bit" from "enough" — which is its whole job. */
    const half = render({ chest: HEAT_FULL / 2 });
    const full = render({ chest: HEAT_FULL });
    const pct = (view: HTMLElement) =>
      Number(/(\d+)%/.exec(shapeFor(view, 'chest').getAttribute('fill') ?? '')?.[1]);

    expect(pct(half.container)).toBeGreaterThan(0);
    expect(pct(half.container)).toBeLessThan(pct(full.container));
    expect(pct(full.container)).toBe(100);
  });

  it('starts a barely-trained muscle at a visible tint rather than fading in', () => {
    // Half a set is the state the map most needs to separate from nothing.
    const { container } = render({ chest: 0.5 });
    const fill = shapeFor(container, 'chest').getAttribute('fill') ?? '';
    expect(fill).toContain('var(--color-volume)');
    expect(Number(/(\d+)%/.exec(fill)?.[1])).toBeGreaterThanOrEqual(20);
  });

  it('keeps the floor visibly short of a full week, which is the point of 15', () => {
    /* Saturating at 8 made clearing the floor and having a genuinely full week
       the same colour. They are different weeks and now they look it. */
    const atFloor = render({ chest: VOLUME_LOW });
    const full = render({ chest: HEAT_FULL });
    const pct = (view: HTMLElement) =>
      Number(/(\d+)%/.exec(shapeFor(view, 'chest').getAttribute('fill') ?? '')?.[1]);
    expect(pct(atFloor.container)).toBeLessThan(pct(full.container));
    expect(pct(atFloor.container)).toBeGreaterThan(50);
  });

  it('stops climbing at the top, so past it the colour is not the claim', () => {
    const atFloor = render({ chest: HEAT_FULL });
    const wayOver = render({ chest: HEAT_FULL * 4 });
    const pct = (view: HTMLElement) =>
      /(\d+)%/.exec(shapeFor(view, 'chest').getAttribute('fill') ?? '')?.[1];
    expect(pct(wayOver.container)).toBe(pct(atFloor.container));
  });
});

describe('over the ceiling', () => {
  it('is marked as a state, not as more colour', () => {
    /* Past 20 sets the message is "back off", which is a different claim from
       "more" and cannot be another step on the same ramp. */
    const { container } = render({ chest: VOLUME_HIGH + 1 });
    expect(shapeFor(container, 'chest').getAttribute('stroke')).toBe('var(--color-rir-1)');
  });

  it('leaves a muscle at the ceiling alone, since the ceiling is allowed', () => {
    const { container } = render({ chest: VOLUME_HIGH });
    expect(shapeFor(container, 'chest').getAttribute('stroke')).toBe('var(--color-surface)');
  });
});

describe('reading it without seeing the colours', () => {
  it('names every muscle and its sets, so the map is not colour alone', () => {
    const { container } = render({ chest: 6, lats: 10.5, calves: 0, biceps: 1 });
    const titles = [...container.querySelectorAll('title')].map((node) => node.textContent);

    expect(titles).toContain('Chest — 6 sets');
    expect(titles).toContain('Lats — 10.5 sets');
    expect(titles).toContain('Calves — 0 sets');
    // Singular, because "1 sets" is the kind of thing that survives for years.
    expect(titles).toContain('Biceps — 1 set');
  });

  it('samples the ramp finely enough to read a difference off it', () => {
    /* The fills are continuous; the key is what a reader compares against, so
       too few swatches and two genuinely different weeks look like one tone. */
    const { container } = render({});
    const swatches = [...container.querySelectorAll('span[style*="color-mix"], span[style*="surface-2"]')]
      .map((node) => node.getAttribute('style') ?? '')
      .filter((style) => style.includes('background'));
    expect(swatches.length).toBeGreaterThanOrEqual(8);
    // Every step a distinct tone: a key with repeats is a key with fewer steps.
    expect(new Set(swatches).size).toBe(swatches.length);
  });

  it('says which figure is which, and what the ramp means', () => {
    const { container } = render({});
    const text = container.textContent ?? '';
    expect(text).toContain('front');
    expect(text).toContain('back');
    expect(text).toContain(`${HEAT_FULL}+ sets a week`);
    expect(text).toContain('none');
  });

  it('is one image to anything that cannot see it at all', () => {
    const { container } = render({});
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toMatch(/weekly set volume per muscle/);
  });
});

describe('both views', () => {
  it('draws a muscle that only shows from behind, from behind', () => {
    /* Glutes have no front shape at all, so a volume record that only reaches
       the front view would silently never shade them. */
    const { container } = render({ glutes: 12 });
    const titles = [...container.querySelectorAll('title')].map((node) => node.textContent);
    expect(titles).toContain('Glutes — 12 sets');
  });

  it('shades a muscle visible from both sides in both places', () => {
    const { container } = render({ calves: 9 });
    const titles = [...container.querySelectorAll('title')].map((node) => node.textContent);
    expect(titles.filter((text) => text === 'Calves — 9 sets')).toHaveLength(2);
  });
});
