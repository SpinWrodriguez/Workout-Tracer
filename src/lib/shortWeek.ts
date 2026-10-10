import { db } from '../db/db';
import type { Block, BlockExercise, DaySlot, Exercise, GolfDay } from '../db/types';
import { shiftIso, todayIso, weekStart } from './format';
import { gripConflictOn } from './golf';
import { CATCH_UP_SLOTS, isGolfSafe, presetOf, type WorkoutDef } from './goalPlans';
import { readPlans, readSchedules, writePlan, writeSchedule, type DatePlan } from './program';

/* -------------------------------------------------------------------------- */
/*  Short weeks — docs/GOAL-PLANS.md §3.                                      */
/*                                                                            */
/*  When the week goes wrong the plan offers what still fits, built from its   */
/*  own rows and never from new exercises, so every lift's history carries     */
/*  on. One day left: one catch-up with the main lift of every workout not     */
/*  done yet. Two days: the workouts themselves where they fit, otherwise two  */
/*  shorter ones. The golf rule decides what can go on the day before a round. */
/*  Whatever is made lives in the catch-up slots and is cleared when the week  */
/*  turns (syncPlanWeek).                                                     */
/* -------------------------------------------------------------------------- */

export interface WeekStatus {
  /** The plan's own workouts this week, in order. */
  workouts: WorkoutDef[];
  /** Workouts already trained this week — by slot, or by a catch-up. */
  done: DaySlot[];
  /** Plan workouts not trained yet. */
  todo: DaySlot[];
  /** Today to Sunday, without a round on them. */
  daysLeft: string[];
  /** A workout's usual day has gone by and it was not trained. */
  behind: boolean;
}

export interface ShortDay {
  date: string;
  /** A plan workout moved here, or a catch-up slot holding a merged session. */
  slot: DaySlot;
  name: string;
  /** Only for a merged session: the rows to write into the catch-up slot. */
  rows?: BlockExercise[];
  /** Exercises the golf rule took out of a merged session. */
  dropped: string[];
}

const golfDatesOf = (golf: GolfDay[]) =>
  golf.map((day) => ({ date: day.date, played: day.status === 'played' }));

/** The day before a round (or the round's own day): golf-safe work only. */
export function golfBlocked(date: string, golf: GolfDay[]): boolean {
  return gripConflictOn(date, golfDatesOf(golf))?.severity === 'blocked';
}

export async function readWeekStatus(block: Block, date = todayIso()): Promise<WeekStatus> {
  const monday = weekStart(date);
  const sunday = shiftIso(monday, 6);
  const workouts = presetOf(block.plan?.goal).workouts;
  const [sessions, golf] = await Promise.all([
    db.session
      .where('date')
      .between(monday, sunday, true, true)
      .filter((session) => session.blockId === block.id)
      .toArray(),
    db.golfDay.toArray(),
  ]);
  const trainedSlots = new Set(sessions.map((session) => session.daySlot));
  /* A catch-up counts as the workouts it stood in for: the plan made it from
     every workout still to do at the time, so all of those are covered. */
  const caughtUp = sessions.some((session) => CATCH_UP_SLOTS.includes(session.daySlot as DaySlot));
  const done = workouts
    .map((w) => w.slot)
    .filter((slot) => trainedSlots.has(slot) || caughtUp);
  const todo = workouts.map((w) => w.slot).filter((slot) => !done.includes(slot));
  const golfDays = new Set(golf.map((day) => day.date));
  const daysLeft = Array.from({ length: 7 }, (_, i) => shiftIso(monday, i)).filter(
    (day) => day >= date && day >= block.startDate && !golfDays.has(day),
  );
  const behind = workouts.some(
    (w) => todo.includes(w.slot) && shiftIso(monday, w.weekday - 1) < date,
  );
  return { workouts, done, todo, daysLeft, behind };
}

/** The row with the given role in a plan workout, in order. */
function rowsOf(entries: BlockExercise[], slot: DaySlot, role?: BlockExercise['role']) {
  return entries
    .filter((row) => row.daySlot === slot && (role === undefined || row.role === role))
    .sort((a, b) => a.order - b.order);
}

/**
 * What the remaining days can hold. `dates` are the days chosen, earliest
 * first; `todo` the plan workouts not done yet.
 */
export function shortWeekPlan({
  dates,
  todo,
  workouts,
  entries,
  exercisesById,
  golf,
}: {
  dates: string[];
  todo: DaySlot[];
  workouts: WorkoutDef[];
  entries: BlockExercise[];
  exercisesById: Map<string, Exercise>;
  golf: GolfDay[];
}): ShortDay[] {
  if (dates.length === 0 || todo.length === 0) return [];
  const sorted = [...dates].sort();
  const safe = (row: BlockExercise) => {
    const exercise = exercisesById.get(row.exerciseId);
    return exercise ? isGolfSafe(exercise) : false;
  };
  const nameOf = (slot: DaySlot) => workouts.find((w) => w.slot === slot)?.name ?? slot;
  const blocked = sorted.map((date) => golfBlocked(date, golf));

  /* As many days as workouts left: move the workouts themselves, the
     golf-safe one onto the day before golf. Only when every one fits. */
  if (sorted.length >= todo.length) {
    const golfSafeSlot = (slot: DaySlot) => workouts.find((w) => w.slot === slot)?.golfSafe ?? false;
    const queue = [...todo].sort((a, b) => Number(golfSafeSlot(b)) - Number(golfSafeSlot(a)));
    const placed: ShortDay[] = [];
    const free = sorted.map((date, i) => ({ date, blocked: blocked[i] as boolean }));
    for (const slot of queue) {
      const spot =
        free.find((day) => day.blocked && golfSafeSlot(slot)) ??
        free.find((day) => !day.blocked) ??
        (golfSafeSlot(slot) ? free[0] : undefined);
      if (!spot) break;
      free.splice(free.indexOf(spot), 1);
      placed.push({ date: spot.date, slot, name: nameOf(slot), dropped: [] });
    }
    if (placed.length === todo.length) return placed.sort((a, b) => a.date.localeCompare(b.date));
  }

  /* Fewer days than workouts: merge. Every main lift of every workout still
     to do, golf work from the first, and one or two accessories where they
     fit. Heavy-for-golf mains go to a day that allows them. */
  const days = sorted.slice(0, 2).map((date, i) => ({
    date,
    blocked: blocked[i] as boolean,
    rows: [] as BlockExercise[],
    dropped: [] as string[],
  }));
  const place = (row: BlockExercise, prefer?: number) => {
    const allowed = days.filter((day) => !day.blocked || safe(row));
    if (allowed.length === 0) {
      days[0]?.dropped.push(exercisesById.get(row.exerciseId)?.name ?? row.exerciseId);
      return;
    }
    const target =
      prefer !== undefined && allowed.includes(days[prefer] as never)
        ? (days[prefer] as (typeof days)[number])
        : allowed.reduce((a, b) => (b.rows.length < a.rows.length ? b : a));
    if (target.rows.some((r) => r.exerciseId === row.exerciseId)) return;
    target.rows.push(row);
  };

  const first = todo[0] as DaySlot;
  for (const row of [...rowsOf(entries, first, 'power'), ...rowsOf(entries, first, 'core')]) place(row, 0);
  if (days.length > 1 && todo[1]) {
    for (const row of [...rowsOf(entries, todo[1], 'power'), ...rowsOf(entries, todo[1], 'core')]) place(row, 1);
  }
  for (const slot of todo) for (const row of rowsOf(entries, slot, 'main')) place(row);
  const accessories = todo.flatMap((slot) => rowsOf(entries, slot, 'accessory'));
  const room = days.length === 1 ? 2 : 4;
  for (const row of accessories.slice(0, room)) place(row);

  return days
    .filter((day) => day.rows.length > 0)
    .map((day, i) => ({
      date: day.date,
      slot: CATCH_UP_SLOTS[i] as DaySlot,
      name: days.length === 1 ? 'Catch-up' : `Short day ${i + 1}`,
      dropped: day.dropped,
      rows: day.rows.map((row, order) => ({
        ...row,
        daySlot: CATCH_UP_SLOTS[i] as DaySlot,
        order,
        // A merged session is a short one: no exercise past three sets.
        targetSets: Math.min(row.targetSets, 3),
      })),
    }));
}

/**
 * Puts the short week on the calendar: catch-up rows written, the chosen days
 * set, and every other day still to come this week cleared, so the strip and
 * Home show what will actually happen.
 */
export async function applyShortWeek(block: Block, days: ShortDay[], date = todayIso()): Promise<void> {
  const monday = weekStart(date);
  const sunday = shiftIso(monday, 6);
  const plans = (await readPlans())[block.id] ?? {};
  const next: DatePlan = { ...plans };
  for (let d = date; d <= sunday; d = shiftIso(d, 1)) next[d] = null;
  for (const day of days) next[day.date] = day.slot;

  const schedule = (await readSchedules())[block.id] ?? {};
  for (const slot of CATCH_UP_SLOTS) delete schedule[slot];
  const rows: BlockExercise[] = [];
  for (const day of days) {
    if (!day.rows) continue;
    schedule[day.slot] = { intensity: 'heavy', name: day.name };
    rows.push(...day.rows);
  }
  await db.transaction('rw', db.blockExercise, async () => {
    await db.blockExercise
      .where('blockId')
      .equals(block.id)
      .filter((row) => CATCH_UP_SLOTS.includes(row.daySlot))
      .delete();
    if (rows.length) await db.blockExercise.bulkPut(rows);
  });
  await writeSchedule(block.id, schedule);
  await writePlan(block.id, next);
}

/** Skip this week: clear what is left of it. The week repeats next week. */
export async function skipRestOfWeek(block: Block, date = todayIso()): Promise<void> {
  await applyShortWeek(block, [], date);
}
