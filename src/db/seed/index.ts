import { db } from '../db';
import { withSyncSuspended } from '../../lib/workoutSync';
import type { Block } from '../types';
import { EXERCISES } from './exercises';

export * from './exercises';
export * from './muscles';

/**
 * Every block needs an id for Session.blockId. Phase 1 has no block builder,
 * so the first run creates one open-ended block to log against; Phase 3
 * replaces this with a real mesocycle builder.
 */
export const DEFAULT_BLOCK_ID = 'block_1';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultBlock(): Block {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + 7 * 8); // 6–8 weeks; take the long end
  return {
    id: DEFAULT_BLOCK_ID,
    startDate: isoDate(start),
    endDate: isoDate(end),
    focusMuscles: [],
    notes: 'Starter block. Exercises are picked freely until the Phase 3 block builder lands.',
  };
}

/**
 * Everything in the database that the seed no longer lists AND nobody has
 * ever logged a set against.
 *
 * `bulkPut` adds and updates but never removes, so dropping an exercise from
 * the seed file left it on every installed device forever — it went on
 * showing in the picker and the generator could still draw it. The ab wheel
 * rollout was the first removal and would have been invisible.
 *
 * The logged-against check is what makes this safe to run on every boot: a
 * removal must never turn somebody's History into a raw id. An exercise with
 * sets behind it stays in the table whatever the seed says, and only the seed
 * decides what is offered.
 */
async function prunable(): Promise<string[]> {
  const seeded = new Set(EXERCISES.map((exercise) => exercise.id));
  const stale = (await db.exercise.toArray())
    .map((exercise) => exercise.id)
    .filter((id) => !seeded.has(id));
  if (stale.length === 0) return [];

  const used = new Set<string>();
  for (const id of stale) {
    const logged = await db.setLog.where('exerciseId').equals(id).count();
    if (logged > 0) used.add(id);
  }
  return stale.filter((id) => !used.has(id));
}

/**
 * Idempotent. Re-seeds the exercise table on every boot so edits to the seed
 * file reach an already-installed app, but never touches logged data.
 */
export async function seedDatabase(): Promise<void> {
  await withSyncSuspended(async () => {
    await db.exercise.bulkPut(EXERCISES);
    const gone = await prunable();
    if (gone.length > 0) await db.exercise.bulkDelete(gone);
    // The starter block is a write to a synced table, but it is the build
    // speaking rather than the user — a fresh install must not look dirty.
    if (!(await db.block.get(DEFAULT_BLOCK_ID))) {
      await db.block.put(defaultBlock());
    }
  });
}
