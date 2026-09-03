import type { Exercise } from '../db/types';

/* -------------------------------------------------------------------------- */
/*  Loadable weights — spec §2 and Phase 2.                                   */
/*                                                                            */
/*  A weight input must never offer a number you cannot actually load. Every   */
/*  ladder here is derived from the real inventory, and the top of each ladder */
/*  is a hard stop.                                                           */
/* -------------------------------------------------------------------------- */

/** One row of the plate rack. `pairs` is how many matched pairs are owned. */
export interface PlatePair {
  kg: number;
  pairs: number;
}

export interface Inventory {
  /** Plates, counted in pairs — a bar takes one of each pair per side. */
  plates: PlatePair[];
  /**
   * Fixed implements you hold: kettlebells, dumbbells. Loaded as-is, never
   * stacked. Plate weights are hand-held loads too — see handHeldWeights.
   */
  kettlebells: number[];
  /** Bar weights by station, overriding the seeded Exercise.barWeight. */
  barWeights: { free_bar: number; smith: number };
  /** One functional-trainer stack and its selector step. */
  cableStackKg: number;
  cableStepKg: number;
}

/** Spec §2: one pair each of 20/10/5 plus two pairs of 1.5. */
export const DEFAULT_INVENTORY: Inventory = {
  plates: [
    { kg: 20, pairs: 1 },
    { kg: 10, pairs: 1 },
    { kg: 5, pairs: 1 },
    { kg: 1.5, pairs: 2 },
  ],
  /* None in this garage: the plates have grips, so a hand-held load is one
     plate. Add real bells here in Settings if there ever are any. */
  kettlebells: [],
  barWeights: { free_bar: 20, smith: 18 },
  cableStackKg: 70,
  cableStepKg: 5,
};

/** Guards against float dust from 1.5 kg plates: 0.05 kg resolution. */
function round(kg: number): number {
  return Math.round(kg * 20) / 20;
}

function dedupeSorted(values: number[]): number[] {
  return [...new Set(values.map(round))].sort((a, b) => a - b);
}

/** Every load you can build on one side of a bar, including bare. */
function perSideSums(plates: PlatePair[]): number[] {
  let sums = [0];
  for (const { kg, pairs } of plates) {
    if (!(kg > 0) || !(pairs > 0)) continue;
    const next: number[] = [];
    for (const base of sums) {
      for (let n = 0; n <= pairs; n += 1) next.push(base + n * kg);
    }
    sums = dedupeSorted(next);
  }
  return sums;
}

/**
 * The core of Phase 2. Plates go on in pairs, so a bar's total is the bar plus
 * twice whatever one side can hold.
 *
 * With barKg 0 this is the hand-held ladder — what a goblet squat or a loaded
 * split squat can actually be set to.
 */
export function loadableWeights(barKg: number, plates: PlatePair[]): number[] {
  const totals = perSideSums(plates).map((side) => round(barKg + side * 2));
  return dedupeSorted(totals.filter((kg) => kg > 0));
}

/** Selector positions on one stack, spec §2: 13 × 5 kg plates + 5 kg rod. */
export function cableStackWeights(stackKg: number, stepKg: number): number[] {
  if (!(stackKg > 0) || !(stepKg > 0)) return [];
  const out: number[] = [];
  for (let kg = stepKg; kg <= stackKg + 1e-9; kg += stepKg) out.push(round(kg));
  return out;
}

/**
 * What a hand can hold: one implement, not a bar's worth of plates.
 *
 * This used to run the plate maths with a bar of zero, which is the symmetric
 * pair logic — one plate per side — and it offered a Swing every rung up to
 * 86 kg. Nobody swings the whole rack. A gripped plate is held singly, so the
 * rungs are the plate weights themselves plus any real bells.
 *
 * No sums: two plates on one grip is not a thing this rack does, and offering
 * 15 kg for a 10 and a 5 would be inventing a load that cannot be picked up.
 */
export function handHeldWeights(plates: PlatePair[], kettlebells: number[]): number[] {
  return dedupeSorted([
    ...plates.filter((plate) => plate.pairs > 0 && plate.kg > 0).map((plate) => plate.kg),
    ...kettlebells.filter((kg) => kg > 0),
  ]);
}

/* --- per-exercise ladder -------------------------------------------------- */

const cache = new Map<string, number[]>();

function inventoryKey(inventory: Inventory): string {
  const plates = inventory.plates.map((p) => `${p.kg}x${p.pairs}`).join(',');
  const bells = [...inventory.kettlebells].sort((a, b) => a - b).join(',');
  const { free_bar: free, smith } = inventory.barWeights;
  return `${plates}|${bells}|${free}|${smith}|${inventory.cableStackKg}|${inventory.cableStepKg}`;
}

/** Bar weight for an exercise, letting Settings override the seed. */
export function barWeightFor(exercise: Exercise, inventory: Inventory): number | undefined {
  if (exercise.station === 'free_bar') return inventory.barWeights.free_bar;
  if (exercise.station === 'smith') return inventory.barWeights.smith;
  return exercise.barWeight;
}

/**
 * The rungs this exercise can actually be set to. Empty for bodyweight and
 * band work, which carry no quantifiable load.
 *
 * Cached per (station, bar, inventory) — the spec asks for the ladder to be
 * computed at setup rather than per keystroke, and the inputs change rarely.
 */
export function ladderFor(exercise: Exercise, inventory: Inventory): number[] {
  if (exercise.loadMode !== 'weight') return [];

  const bar = barWeightFor(exercise, inventory);
  const key =
    exercise.station === 'cable'
      ? `cable|${inventoryKey(inventory)}`
      : `${bar ?? 0}|${inventoryKey(inventory)}`;

  const hit = cache.get(key);
  if (hit) return hit;

  let ladder: number[];
  if (exercise.station === 'cable') {
    ladder = cableStackWeights(inventory.cableStackKg, inventory.cableStepKg);
  } else if (bar !== undefined) {
    ladder = loadableWeights(bar, inventory.plates);
  } else {
    ladder = handHeldWeights(inventory.plates, inventory.kettlebells);
  }

  cache.set(key, ladder);
  return ladder;
}

/** Only for tests and for Settings, after the inventory is edited. */
export function clearLadderCache(): void {
  cache.clear();
}

/* --- moving along a ladder ------------------------------------------------- */

/** Nearest rung; a tie goes to the lighter one. Never returns 27 kg. */
export function snapToLadder(value: number, ladder: number[]): number | undefined {
  if (ladder.length === 0) return undefined;
  let best = ladder[0] as number;
  let bestGap = Math.abs(value - best);
  for (const rung of ladder) {
    const gap = Math.abs(value - rung);
    if (gap < bestGap) {
      best = rung;
      bestGap = gap;
    }
  }
  return best;
}

export function isLoadable(value: number, ladder: number[]): boolean {
  return ladder.some((rung) => Math.abs(rung - value) < 1e-9);
}

/** The next rung strictly above `value`, or undefined at the ceiling. */
export function nextRung(value: number, ladder: number[]): number | undefined {
  return ladder.find((rung) => rung > value + 1e-9);
}

export function prevRung(value: number, ladder: number[]): number | undefined {
  return [...ladder].reverse().find((rung) => rung < value - 1e-9);
}

export function ceilingOf(ladder: number[]): number | undefined {
  return ladder.at(-1);
}

export function atCeiling(value: number, ladder: number[]): boolean {
  const top = ceilingOf(ladder);
  return top !== undefined && value >= top - 1e-9;
}

/**
 * Size of the next step up, as a percentage of the current load. Above ~10%
 * the jump is big enough that microplates are worth suggesting (spec Phase 2);
 * with this inventory that fires on the 26 → 30 style gaps at light loads.
 */
export const MICROPLATE_THRESHOLD_PCT = 10;

export function jumpPercent(value: number, ladder: number[]): number | undefined {
  if (!(value > 0)) return undefined;
  const next = nextRung(value, ladder);
  if (next === undefined) return undefined;
  return ((next - value) / value) * 100;
}

export function microplateHint(value: number, ladder: number[]): string | undefined {
  const pct = jumpPercent(value, ladder);
  if (pct === undefined || pct <= MICROPLATE_THRESHOLD_PCT) return undefined;
  return `Smallest available jump is ${pct.toFixed(0)}% — consider microplates`;
}
