/*
 * Harness for the DOM suites. Import this FIRST in a jsdom test file: it loads
 * fake-indexeddb before anything can reach for `db`, and registers the reset
 * that keeps one test's block out of the next one's.
 *
 * Why this file exists at all: every UI claim in this project used to be
 * verified by hand-driving Chrome from a throwaway script. That caught real
 * bugs — a keypad covering the RIR badge, setup controls silently resetting, a
 * save button that never appeared — and then guarded none of them. These
 * suites drive the same flows the way a user does, by role and text.
 */

import 'fake-indexeddb/auto';

import { cleanup, render, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, vi } from 'vitest';
import { db } from '../db/db';
import { EXERCISES } from '../db/seed/exercises';
import { seedDatabase } from '../db/seed';
import { DEFAULT_BLOCK_ID } from '../db/seed';
import type { Block, BlockExercise, DaySlot, Exercise } from '../db/types';
import { writePlan, writeSchedule, type BlockSchedule } from '../lib/program';

/*
 * jsdom has no layout, so it does not implement scrollIntoView. The session
 * screen calls it to keep the row being edited clear of the keypad, and
 * `?.scrollIntoView()` guards a missing element, not a missing method.
 */
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

beforeEach(async () => {
  localStorage.clear();
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await seedDatabase();
});

afterEach(() => {
  /*
   * Explicit because vitest is not running with `globals`, so testing-library's
   * automatic cleanup never registers. Without it every render stacks up in the
   * same document and the second test in a file sees two of everything.
   */
  cleanup();
  vi.restoreAllMocks();
});

/** The seeded library, as the screens receive it from App. */
export const exercises: Exercise[] = EXERCISES;
export const exercisesById = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));

export function named(id: string): string {
  const exercise = exercisesById.get(id);
  if (!exercise) throw new Error(`no seeded exercise ${id}`);
  return exercise.name;
}

/*
 * The block is the one seedDatabase creates on a first run, not a second one
 * of our own: readBlockPlan takes the LATEST block by start date, so an extra
 * block dated in the past is invisible to every screen. Found the hard way.
 */
export const BLOCK_ID = DEFAULT_BLOCK_ID;

/** The seeded block, with anything a test needs to differ patched onto it. */
export async function seedBlock(overrides: Partial<Block> = {}): Promise<Block> {
  const existing = await db.block.get(BLOCK_ID);
  if (!existing) throw new Error('seedDatabase did not create the starter block');
  const block = { ...existing, ...overrides, id: BLOCK_ID };
  await db.block.put(block);
  return block;
}

export async function seedSchedule(schedule: BlockSchedule): Promise<void> {
  await writeSchedule(BLOCK_ID, schedule);
}

/** Programmed exercises for one workout, in the order given. */
export async function seedWorkout(
  slot: DaySlot,
  exerciseIds: string[],
  targetSets = 3,
): Promise<void> {
  const rows: BlockExercise[] = exerciseIds.map((exerciseId, order) => ({
    blockId: BLOCK_ID,
    exerciseId,
    daySlot: slot,
    targetSets,
    repRangeLow: 8,
    repRangeHigh: 10,
    order,
  }));
  await db.blockExercise.bulkPut(rows);
}

/**
 * `userEvent` with its own delay disabled. The default advances fake timers
 * between events, and these suites use real ones — `useLiveQuery` resolves on
 * its own schedule and is waited for with findBy*, not by counting ticks.
 */
export function user() {
  return userEvent.setup({ delay: null });
}

export function draw(ui: ReactElement): RenderResult {
  return render(ui);
}

/** Stubs window.confirm for one test, so a guarded action can be driven. */
export function confirmWith(answer: boolean): void {
  vi.spyOn(window, 'confirm').mockReturnValue(answer);
}

/** What is planned on specific dates, which is the only placement that recurs nowhere. */
export async function seedPlan(plan: Record<string, DaySlot>): Promise<void> {
  await writePlan(BLOCK_ID, plan);
}
