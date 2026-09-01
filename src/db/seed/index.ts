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
 * Idempotent. Re-seeds the exercise table on every boot so edits to the seed
 * file reach an already-installed app, but never touches logged data.
 */
export async function seedDatabase(): Promise<void> {
  await withSyncSuspended(async () => {
    await db.exercise.bulkPut(EXERCISES);
    // The starter block is a write to a synced table, but it is the build
    // speaking rather than the user — a fresh install must not look dirty.
    if (!(await db.block.get(DEFAULT_BLOCK_ID))) {
      await db.block.put(defaultBlock());
    }
  });
}
