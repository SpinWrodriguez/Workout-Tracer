import { db } from '../db/db';
import type { Block, BlockExercise, DaySlot, Exercise } from '../db/types';
import { weekdayOf, type Weekday } from './golf';
import { todayIso } from './format';
import { emptySet, newSessionId, type SessionDraft } from './sessions';

/* -------------------------------------------------------------------------- */
/*  Program → workout.                                                        */
/*                                                                            */
/*  The block builder decides both WHAT each day slot contains and WHICH       */
/*  weekday it lands on — the second half is the whole point of the golf rule. */
/*  BlockExercise is pinned to §5 and has no weekday field, so the slot →      */
/*  weekday map is kept beside it in the settings table. Without it the app    */
/*  knows day A exists but not that day A is Monday, and "start today's        */
/*  session" is unanswerable.                                                 */
/* -------------------------------------------------------------------------- */

export const BLOCK_SCHEDULE_KEY = 'blockSchedule';

/** slot → ISO weekday, per block. */
export type BlockSchedule = Partial<Record<DaySlot, Weekday>>;
export type ScheduleByBlock = Record<string, BlockSchedule>;

const SLOTS: DaySlot[] = ['A', 'B', 'C', 'X', 'Y'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function normaliseSchedule(value: unknown): ScheduleByBlock {
  if (!isRecord(value)) return {};
  const out: ScheduleByBlock = {};
  for (const [blockId, slots] of Object.entries(value)) {
    if (!isRecord(slots)) continue;
    const map: BlockSchedule = {};
    for (const slot of SLOTS) {
      const weekday = Number(slots[slot]);
      if (Number.isInteger(weekday) && weekday >= 1 && weekday <= 7) {
        map[slot] = weekday as Weekday;
      }
    }
    if (Object.keys(map).length > 0) out[blockId] = map;
  }
  return out;
}

export async function readSchedules(): Promise<ScheduleByBlock> {
  const row = await db.settings.get(BLOCK_SCHEDULE_KEY);
  return normaliseSchedule(row?.value);
}

export async function writeSchedule(blockId: string, schedule: BlockSchedule): Promise<void> {
  const all = await readSchedules();
  await db.settings.put({
    key: BLOCK_SCHEDULE_KEY,
    value: { ...all, [blockId]: schedule },
  });
}

/** The day slot programmed for a given date, if any. */
export function slotForDate(schedule: BlockSchedule, dateIso: string): DaySlot | undefined {
  const weekday = weekdayOf(dateIso);
  return SLOTS.find((slot) => schedule[slot] === weekday);
}

/** Slots in the order they are trained, for "what's next" style prompts. */
export function orderedSlots(schedule: BlockSchedule): { slot: DaySlot; weekday: Weekday }[] {
  return SLOTS.filter((slot) => schedule[slot] !== undefined)
    .map((slot) => ({ slot, weekday: schedule[slot] as Weekday }))
    .sort((a, b) => a.weekday - b.weekday);
}

/** Days from `dateIso` forward to the next occurrence of `weekday`. */
export function daysUntilWeekday(dateIso: string, weekday: Weekday): number {
  return (weekday - weekdayOf(dateIso) + 7) % 7;
}

/**
 * The slot to offer when nothing is programmed for today: the soonest one
 * coming up, so the prompt is "Day B is Thursday" rather than silence.
 */
export function nextSlot(
  schedule: BlockSchedule,
  dateIso: string,
): { slot: DaySlot; weekday: Weekday; inDays: number } | undefined {
  const upcoming = orderedSlots(schedule)
    .map((entry) => ({ ...entry, inDays: daysUntilWeekday(dateIso, entry.weekday) }))
    .sort((a, b) => a.inDays - b.inDays);
  return upcoming[0];
}

/* --- building a session from the block ------------------------------------ */

export interface BlockPlan {
  block: Block;
  schedule: BlockSchedule;
  entries: BlockExercise[];
}

export async function readBlockPlan(): Promise<BlockPlan | undefined> {
  const block = await db.block.orderBy('startDate').reverse().first();
  if (!block) return undefined;
  const [schedules, entries] = await Promise.all([
    readSchedules(),
    db.blockExercise.where('blockId').equals(block.id).toArray(),
  ]);
  return { block, schedule: schedules[block.id] ?? {}, entries };
}

export function entriesForSlot(entries: BlockExercise[], slot: DaySlot): BlockExercise[] {
  return entries.filter((entry) => entry.daySlot === slot).sort((a, b) => a.order - b.order);
}

/**
 * A session pre-loaded with the day's programmed exercises, one empty set per
 * target set. Weights are left blank on purpose: the per-exercise progression
 * suggestion fills them in, and it should be the thing that decides the load.
 */
export function draftFromPlan({
  plan,
  slot,
  exercisesById,
  date = todayIso(),
}: {
  plan: BlockPlan;
  slot: DaySlot;
  exercisesById: Map<string, Exercise>;
  date?: string;
}): SessionDraft {
  const entries = entriesForSlot(plan.entries, slot).filter((entry) =>
    exercisesById.has(entry.exerciseId),
  );
  return {
    id: newSessionId(date),
    blockId: plan.block.id,
    daySlot: slot,
    date,
    exercises: entries.map((entry) => ({
      exerciseId: entry.exerciseId,
      sets: Array.from({ length: Math.max(1, entry.targetSets) }, (_, i) => emptySet(i + 1)),
    })),
  };
}

export function emptyDraft(blockId: string, slot: DaySlot, date = todayIso()): SessionDraft {
  return { id: newSessionId(date), blockId, daySlot: slot, date, exercises: [] };
}
