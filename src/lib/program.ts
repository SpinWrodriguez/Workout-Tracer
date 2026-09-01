import { db } from '../db/db';
import type { Block, BlockExercise, DaySlot, Exercise } from '../db/types';
import { weekdayOf, type Weekday } from './golf';
import { desiredRange } from './blockBuilder';
import { maxPrescription } from './repUnit';
import { workingRepRange } from './blockValidation';
import { LIGHT_DAY_CUE, type Intensity } from './weekTemplate';
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
export const BLOCK_PLAN_KEY = 'blockPlan';

/**
 * What a workout is: how hard it is meant to be, and the weekday it USUALLY
 * falls on. "Usually" is the whole point — the weekday used to be the workout's
 * only address, so moving Wednesday's session to Thursday moved it in every
 * week that would ever exist. What happens on a particular date is a separate
 * thing entirely; see DatePlan.
 */
export interface ScheduledDay {
  weekday: Weekday;
  intensity: Intensity;
  /** Shown while logging, e.g. "Leave 3-4 reps in the tank". */
  effortCue?: string;
  /**
   * This day came out of the generator. Persisted rather than kept in screen
   * state so re-rolling it survives a reload — and so a day built by hand is
   * still recognisable as one after the app restarts, which is what keeps
   * "shuffle" from being offered where it would throw away real work.
   */
  generated?: boolean;
  /**
   * What to call this day. Written by the generator from what the day actually
   * contains, and overridden by anything the user types. Absent means "work it
   * out from the exercises", which is what keeps a regenerated day from
   * carrying the previous session's name.
   */
  name?: string;
}

export type BlockSchedule = Partial<Record<DaySlot, ScheduledDay>>;
export type ScheduleByBlock = Record<string, BlockSchedule>;

/* -------------------------------------------------------------------------- */
/*  What is actually happening on a given date.                               */
/*                                                                            */
/*  The recurring pattern says where a workout usually falls; this says where  */
/*  it fell in one particular week. An entry wins over the pattern, and null    */
/*  is a decision rather than an absence: "nothing on this date", as against    */
/*  "no opinion, use the usual day".                                          */
/*                                                                            */
/*  Without this layer the two questions are the same question, and rescheduling*/
/*  one Wednesday rewrites every Wednesday from here to the end of the block.  */
/* -------------------------------------------------------------------------- */

export type DatePlan = Record<string, DaySlot | null>;
export type PlanByBlock = Record<string, DatePlan>;

/*
 * Every workout id. Generated weeks still take A, B, C, X, Y in that order, so
 * a week built by an older version lands on exactly the slots it always did;
 * D-J are what "Add a day" reaches for once those are used.
 */
export const SLOTS: DaySlot[] = ['A', 'B', 'C', 'X', 'Y', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

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
      const raw = slots[slot];
      // Schedules written before intensity existed are a bare weekday number.
      const value = isRecord(raw) ? raw : { weekday: raw, intensity: 'heavy' };
      const weekday = Number(value.weekday);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) continue;
      const intensity: Intensity = value.intensity === 'light' ? 'light' : 'heavy';
      map[slot] = {
        weekday: weekday as Weekday,
        intensity,
        effortCue: intensity === 'light' ? LIGHT_DAY_CUE : undefined,
        // Absent rather than false: a hand-built day keeps the shape it has
        // always had, and only generated days carry the extra key.
        ...(value.generated === true ? { generated: true } : {}),
        ...(typeof value.name === 'string' && value.name.trim()
          ? { name: value.name.trim() }
          : {}),
      };
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

/**
 * What is programmed for one date: whatever was planned for that date, and
 * otherwise whichever workout usually falls on that weekday. A null entry
 * means the date was deliberately cleared, so the usual day does not creep
 * back in.
 */
export function slotForDate(
  schedule: BlockSchedule,
  dateIso: string,
  plan: DatePlan = {},
): DaySlot | undefined {
  const planned = plan[dateIso];
  if (planned !== undefined) return planned ?? undefined;
  const weekday = weekdayOf(dateIso);
  return SLOTS.find((slot) => schedule[slot]?.weekday === weekday);
}

/**
 * Puts one workout on one date, and nothing else. Anything already on that
 * date is displaced, and the workout's own previous date that week is cleared,
 * so dragging is a move rather than a copy.
 */
export function planDate(
  plan: DatePlan,
  schedule: BlockSchedule,
  weekDates: string[],
  slot: DaySlot | undefined,
  dateIso: string,
): DatePlan {
  const next: DatePlan = { ...plan };

  // Every date in the displayed week is pinned before anything moves. Without
  // this the untouched days still resolve through the recurring pattern, so
  // moving one session shuffles the others as a side effect.
  for (const date of weekDates) {
    if (next[date] === undefined) next[date] = slotForDate(schedule, date, plan) ?? null;
  }

  if (slot === undefined) {
    next[dateIso] = null;
    return next;
  }
  for (const date of weekDates) {
    if (date !== dateIso && next[date] === slot) next[date] = null;
  }
  next[dateIso] = slot;
  return next;
}

/** Makes a workout's usual weekday match where it currently sits. */
export function setUsualWeekday(
  schedule: BlockSchedule,
  slot: DaySlot,
  weekday: Weekday,
): BlockSchedule {
  return assignSlot(schedule, slot, weekday);
}

export function normalisePlan(value: unknown): PlanByBlock {
  if (!isRecord(value)) return {};
  const out: PlanByBlock = {};
  for (const [blockId, dates] of Object.entries(value)) {
    if (!isRecord(dates)) continue;
    const map: DatePlan = {};
    for (const [date, slot] of Object.entries(dates)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (slot === null) map[date] = null;
      else if (typeof slot === 'string' && SLOTS.includes(slot as DaySlot)) {
        map[date] = slot as DaySlot;
      }
    }
    if (Object.keys(map).length > 0) out[blockId] = map;
  }
  return out;
}

export async function readPlans(): Promise<PlanByBlock> {
  const row = await db.settings.get(BLOCK_PLAN_KEY);
  return normalisePlan(row?.value);
}

export async function writePlan(blockId: string, plan: DatePlan): Promise<void> {
  const all = await readPlans();
  await db.settings.put({ key: BLOCK_PLAN_KEY, value: { ...all, [blockId]: plan } });
}

/** The inverse map: which slot, if any, is trained on each weekday. */
export function slotsByWeekday(schedule: BlockSchedule): Partial<Record<Weekday, DaySlot>> {
  const out: Partial<Record<Weekday, DaySlot>> = {};
  for (const slot of SLOTS) {
    const day = schedule[slot];
    if (day !== undefined) out[day.weekday] = slot;
  }
  return out;
}

/** Moves a slot to a weekday, evicting whatever already sat there. */
export function assignSlot(
  schedule: BlockSchedule,
  slot: DaySlot,
  weekday: Weekday | undefined,
): BlockSchedule {
  const next: BlockSchedule = { ...schedule };
  if (weekday === undefined) {
    delete next[slot];
    return next;
  }
  // Two sessions cannot share a weekday, so the occupant swaps into the slot's
  // old day if it had one, and is otherwise unscheduled.
  const displaced = (Object.keys(next) as DaySlot[]).find(
    (other) => other !== slot && next[other]?.weekday === weekday,
  );
  const previous = next[slot];
  next[slot] = { ...(previous ?? { intensity: 'heavy' as Intensity }), weekday };
  if (displaced) {
    if (previous === undefined) delete next[displaced];
    else next[displaced] = { ...(next[displaced] as ScheduledDay), weekday: previous.weekday };
  }
  return next;
}

/** Slots in the order they are trained, for "what's next" style prompts. */
export function orderedSlots(schedule: BlockSchedule): { slot: DaySlot; weekday: Weekday }[] {
  return SLOTS.filter((slot) => schedule[slot] !== undefined)
    .map((slot) => ({ slot, weekday: (schedule[slot] as ScheduledDay).weekday }))
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

/**
 * The setup controls read back out of the schedule: how many sessions there
 * are and which of them are heavy. Both are facts about the program, so
 * showing anything else on the Program screen describes somebody else's week
 * — and generating from it would rebuild yours to match.
 *
 * `shape` is deliberately absent: two heavy days look identical whichever
 * split produced them, so that one is stored in the training preferences.
 */
export function configFromSchedule(schedule: BlockSchedule): {
  sessionsPerWeek: number;
  heavyWeekdays: Weekday[];
} | undefined {
  const days = orderedSlots(schedule);
  if (days.length === 0) return undefined;
  return {
    sessionsPerWeek: days.length,
    heavyWeekdays: days
      .filter((entry) => (schedule[entry.slot]?.intensity ?? 'heavy') === 'heavy')
      .map((entry) => entry.weekday),
  };
}

/* --- building a session from the block ------------------------------------ */

export interface BlockPlan {
  block: Block;
  schedule: BlockSchedule;
  /** What is planned on specific dates, overriding the usual weekdays. */
  dates: DatePlan;
  entries: BlockExercise[];
}

export async function readBlockPlan(): Promise<BlockPlan | undefined> {
  const block = await db.block.orderBy('startDate').reverse().first();
  if (!block) return undefined;
  const [schedules, plans, entries] = await Promise.all([
    readSchedules(),
    readPlans(),
    db.blockExercise.where('blockId').equals(block.id).toArray(),
  ]);
  return {
    block,
    schedule: schedules[block.id] ?? {},
    dates: plans[block.id] ?? {},
    entries,
  };
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

/* -------------------------------------------------------------------------- */
/*  Hand-editing a block.                                                     */
/*                                                                            */
/*  The generator is a starting point, not a cage: every day can be built or   */
/*  rewritten by hand. `order` is renormalised on every write so it stays a    */
/*  dense 0..n-1 sequence no matter what was added or removed.                 */
/* -------------------------------------------------------------------------- */

const DEFAULT_TARGET_SETS = 3;
/*
 * Only ever a starting point for an exercise the table does not describe.
 * Adding by hand used to stamp 8-10 on everything, which prescribed a plank
 * eight reps and a Turkish get-up ten — and then the rule check dutifully
 * complained about a range the app itself had chosen.
 */
const FALLBACK_REPS = { low: 8, high: 10 };

async function renumber(blockId: string, slot: DaySlot): Promise<void> {
  const rows = await db.blockExercise
    .where('blockId')
    .equals(blockId)
    .filter((row) => row.daySlot === slot)
    .toArray();
  rows.sort((a, b) => a.order - b.order);
  await db.blockExercise.bulkPut(rows.map((row, i) => ({ ...row, order: i })));
}

export async function addBlockExercise(
  blockId: string,
  slot: DaySlot,
  exerciseId: string,
): Promise<void> {
  const existing = await db.blockExercise.get([blockId, exerciseId, slot]);
  if (existing) return; // already on this day
  const rows = await db.blockExercise.where('blockId').equals(blockId).toArray();
  const order = rows.filter((row) => row.daySlot === slot).length;

  // The same range the generator would have given it: the hypertrophy target
  // for its pattern, clamped to what the movement actually takes.
  const exercise = await db.exercise.get(exerciseId);
  const range = exercise ? workingRepRange(exercise, desiredRange(exercise)) : FALLBACK_REPS;

  await db.blockExercise.put({
    blockId,
    exerciseId,
    daySlot: slot,
    targetSets: DEFAULT_TARGET_SETS,
    repRangeLow: range.low,
    repRangeHigh: range.high,
    order,
  });
}

export async function removeBlockExercise(
  blockId: string,
  slot: DaySlot,
  exerciseId: string,
): Promise<void> {
  await db.blockExercise.delete([blockId, exerciseId, slot]);
  await renumber(blockId, slot);
}

export async function updateBlockExercise(
  entry: BlockExercise,
  patch: Partial<Pick<BlockExercise, 'targetSets' | 'repRangeLow' | 'repRangeHigh'>>,
): Promise<void> {
  const next = { ...entry, ...patch };
  /* A flat cap of 50 is a rep count wearing the wrong hat: on a plank it read
     as fifty seconds, and a two-minute hold could not be prescribed at all. */
  const ceiling = maxPrescription(await db.exercise.get(entry.exerciseId));
  // A range that crosses over is meaningless; keep low at or below high.
  if (next.repRangeLow > next.repRangeHigh) {
    if (patch.repRangeLow !== undefined) next.repRangeHigh = next.repRangeLow;
    else next.repRangeLow = next.repRangeHigh;
  }
  next.targetSets = Math.max(1, Math.min(10, next.targetSets));
  next.repRangeLow = Math.max(1, Math.min(ceiling, next.repRangeLow));
  next.repRangeHigh = Math.max(1, Math.min(ceiling, next.repRangeHigh));
  await db.blockExercise.put(next);
}

/** Moves one exercise up or down within its day. */
export async function moveBlockExercise(
  blockId: string,
  slot: DaySlot,
  exerciseId: string,
  direction: -1 | 1,
): Promise<void> {
  const rows = entriesForSlot(
    await db.blockExercise.where('blockId').equals(blockId).toArray(),
    slot,
  );
  const index = rows.findIndex((row) => row.exerciseId === exerciseId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= rows.length) return;
  const reordered = [...rows];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(target, 0, moved as BlockExercise);
  await db.blockExercise.bulkPut(reordered.map((row, i) => ({ ...row, order: i })));
}

/** Removes a whole day: its exercises and its place in the week. */
export async function clearDaySlot(blockId: string, slot: DaySlot): Promise<void> {
  const rows = await db.blockExercise.where('blockId').equals(blockId).toArray();
  await db.blockExercise.bulkDelete(
    rows.filter((row) => row.daySlot === slot).map((row) => [row.blockId, row.exerciseId, row.daySlot] as [string, string, string]),
  );
  const schedules = await readSchedules();
  const schedule = schedules[blockId];
  if (schedule?.[slot] !== undefined) {
    await writeSchedule(blockId, assignSlot(schedule, slot, undefined));
  }
}
