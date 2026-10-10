import { db } from '../db/db';
import type { BlockExercise, DaySlot, Exercise } from '../db/types';
import { daysBetween, shiftIso, todayIso, weekStart } from './format';
import { gripConflictOn, weekdayOf, type GolfDateLite, type Weekday } from './golf';
import type { DatePlan } from './program';

/* -------------------------------------------------------------------------- */
/*  The plan as a rotation.                                                   */
/*                                                                            */
/*  A plan is an ordered list of the block's workouts, repeated for a number   */
/*  of weeks. Nothing is pinned to a weekday: whatever day you train, you get  */
/*  the next one in order. The days you usually train are a forecast only,    */
/*  so the week strip can show what the rest of the week would hold, drawn    */
/*  dashed because nothing is booked.                                         */
/*                                                                            */
/*  Two rules decide what a day gets. The order: the next workout is the one   */
/*  after the last one logged. The golf eve: the day before a round takes the  */
/*  first golf-safe workout in the queue, because the others carry grip or     */
/*  heavy spinal work the round would pay for. A workout placed on a date by   */
/*  hand still counts, as does a day cleared to nothing.                       */
/* -------------------------------------------------------------------------- */

export const ROTATION_KEY = 'blockRotation';

export interface Rotation {
  /** The workouts, in the order they repeat. */
  order: DaySlot[];
  /** Workouts in the order that only run on weeks with four or more training days. */
  optional: DaySlot[];
  /** The days usually trained. A forecast, not a booking. */
  trainingDays: Weekday[];
  /** The plan's first day; weeks run Monday to Sunday from its week. */
  start: string;
  weeks: number;
}

export type RotationByBlock = Record<string, Rotation>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function normaliseRotation(value: unknown): Rotation | undefined {
  if (!isRecord(value)) return undefined;
  const slots = (v: unknown) =>
    Array.isArray(v) ? v.filter((s): s is DaySlot => typeof s === 'string' && s.length === 1) : [];
  const order = slots(value.order);
  if (order.length === 0 || typeof value.start !== 'string') return undefined;
  const weeks = Number(value.weeks);
  const trainingDays = Array.isArray(value.trainingDays)
    ? value.trainingDays
        .map(Number)
        .filter((d): d is Weekday => Number.isInteger(d) && d >= 1 && d <= 7)
    : [];
  return {
    order,
    optional: slots(value.optional).filter((s) => order.includes(s)),
    trainingDays: [...new Set(trainingDays)].sort((a, b) => a - b),
    start: value.start,
    weeks: Number.isInteger(weeks) && weeks > 0 ? weeks : 8,
  };
}

export async function readRotations(): Promise<RotationByBlock> {
  const row = await db.settings.get(ROTATION_KEY);
  if (!isRecord(row?.value)) return {};
  const out: RotationByBlock = {};
  for (const [blockId, raw] of Object.entries(row.value)) {
    const rotation = normaliseRotation(raw);
    if (rotation) out[blockId] = rotation;
  }
  return out;
}

export async function readRotation(blockId: string): Promise<Rotation | undefined> {
  return (await readRotations())[blockId];
}

/** Sets the block's plan, or ends it with `undefined`. */
export async function writeRotation(blockId: string, rotation: Rotation | undefined): Promise<void> {
  const all = await readRotations();
  if (rotation) all[blockId] = rotation;
  else delete all[blockId];
  await db.settings.put({ key: ROTATION_KEY, value: all });
}

/* --- where the plan is ----------------------------------------------------- */

/** The Monday the plan's weeks count from. */
export function rotationAnchor(rotation: Rotation): string {
  return weekStart(rotation.start);
}

/** The plan's last day: the Sunday that ends its final week. */
export function rotationEnd(rotation: Rotation): string {
  return shiftIso(rotationAnchor(rotation), rotation.weeks * 7 - 1);
}

/** The plan week a date falls in, 1-based; 0 before it starts, weeks+1 after. */
export function rotationWeekOf(rotation: Rotation, date = todayIso()): number {
  if (date < rotation.start) return 0;
  const week = Math.floor(daysBetween(rotationAnchor(rotation), date) / 7) + 1;
  return Math.min(week, rotation.weeks + 1);
}

export function rotationActive(rotation: Rotation, date = todayIso()): boolean {
  return date >= rotation.start && date <= rotationEnd(rotation);
}

/* --- the order --------------------------------------------------------------- */

/** The workout after `last` in the order; the first when nothing was done yet. */
export function nextAfter(rotation: Rotation, last: DaySlot | undefined): DaySlot {
  const at = last === undefined ? -1 : rotation.order.indexOf(last);
  return rotation.order[(at + 1) % rotation.order.length] as DaySlot;
}

/** The order from `from`, once round, skipping the optional ones on short weeks. */
export function queueFrom(rotation: Rotation, from: DaySlot): DaySlot[] {
  const at = Math.max(0, rotation.order.indexOf(from));
  const once = rotation.order.map((_, i) => rotation.order[(at + i) % rotation.order.length] as DaySlot);
  return rotation.trainingDays.length <= 3 ? once.filter((s) => !rotation.optional.includes(s)) : once;
}

/** Safe the day before golf: nothing grip-heavy, nothing heavy on the spine. */
export function golfSafeSlot(
  slot: DaySlot,
  entries: BlockExercise[],
  exercisesById: Map<string, Exercise>,
): boolean {
  const rows = entries.filter((row) => row.daySlot === slot);
  return (
    rows.length > 0 &&
    rows.every((row) => {
      const exercise = exercisesById.get(row.exerciseId);
      return exercise ? exercise.gripLoad !== 'high' && exercise.spinalLoad !== 'high' : true;
    })
  );
}

/* --- the week ---------------------------------------------------------------- */

export type DayKind = 'done' | 'pinned' | 'next' | 'forecast';

export interface RotationDay {
  slot: DaySlot;
  kind: DayKind;
}

export interface ForecastInput {
  rotation: Rotation;
  weekDates: string[];
  /** Sessions of this block, any week, as date → slot (the latest on a date wins). */
  sessions: { date: string; slot: DaySlot }[];
  dates: DatePlan;
  entries: BlockExercise[];
  exercisesById: Map<string, Exercise>;
  golf: GolfDateLite[];
  /** The weekdays a round is usually played, so the eve rule holds before a round is on the calendar. */
  golfWeekdays?: Weekday[];
  today?: string;
}

/** The day before a round, by the calendar or by the usual golf weekdays. */
export function golfEveOn(date: string, golf: GolfDateLite[], golfWeekdays: Weekday[] = []): boolean {
  if (gripConflictOn(date, golf)?.severity === 'blocked') return true;
  return golfWeekdays.includes(weekdayOf(shiftIso(date, 1)));
}

/** The last workout of the order logged before `date`, since the plan began. */
function lastDoneBefore(rotation: Rotation, sessions: ForecastInput['sessions'], date: string) {
  return [...sessions]
    .filter((s) => s.date >= rotation.start && s.date < date && rotation.order.includes(s.slot))
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1)?.slot;
}

/** What is next from `date`'s point of view: the one after the last logged before it. */
export function nextFrom(rotation: Rotation, sessions: ForecastInput['sessions'], date = todayIso()): DaySlot {
  return nextAfter(rotation, lastDoneBefore(rotation, sessions, date));
}

/**
 * The week, date by date. Days gone by show what was logged. From today on,
 * each usual training day takes the next workout in the queue; the day before
 * a round takes the first golf-safe one instead. Pinned dates win, cleared
 * dates stay empty, and the plan's dates bound it all.
 */
export function forecastWeek(input: ForecastInput): Record<string, RotationDay> {
  const { rotation, weekDates, sessions, dates, entries, exercisesById, golf, golfWeekdays } = input;
  const today = input.today ?? todayIso();
  const out: Record<string, RotationDay> = {};
  const end = rotationEnd(rotation);
  const first = weekDates[0] as string;
  // Two rounds, so a week with more training days than workouts goes round
  // again rather than running dry.
  const from = nextFrom(rotation, sessions, today < first ? first : today);
  const queue = [...queueFrom(rotation, from), ...queueFrom(rotation, from)];
  const take = (date: string): DaySlot | undefined => {
    const eve = golfEveOn(date, golf, golfWeekdays);
    const at = eve ? queue.findIndex((s) => golfSafeSlot(s, entries, exercisesById)) : 0;
    if (at === -1) return undefined;
    return queue.splice(at, 1)[0];
  };
  const doneOn = new Map(sessions.map((s) => [s.date, s.slot]));
  let marked = false;
  for (const date of weekDates) {
    const done = doneOn.get(date);
    if (done) {
      out[date] = { slot: done, kind: 'done' };
      continue;
    }
    if (date < today) continue;
    const pinned = dates[date];
    if (pinned === null) continue;
    if (pinned !== undefined) {
      out[date] = { slot: pinned, kind: marked ? 'forecast' : 'next' };
      marked = true;
      const at = queue.indexOf(pinned);
      if (at !== -1) queue.splice(at, 1);
      continue;
    }
    if (date < rotation.start || date > end) continue;
    if (!rotation.trainingDays.includes(weekdayOf(date))) continue;
    const slot = take(date);
    if (!slot) continue;
    out[date] = { slot, kind: marked ? 'forecast' : 'next' };
    marked = true;
  }
  return out;
}

/** The slot a day sheet should offer first, and the rest in order behind it. */
export function offerFor(
  date: string,
  input: Omit<ForecastInput, 'weekDates'>,
): { first: DaySlot; rest: DaySlot[]; golfEve: boolean } {
  const { rotation, sessions, entries, exercisesById, golf, golfWeekdays } = input;
  const week = forecastWeek({ ...input, weekDates: [date] });
  const golfEve = golfEveOn(date, golf, golfWeekdays);
  const queue = queueFrom(rotation, nextFrom(rotation, sessions, date));
  const first =
    week[date]?.slot ??
    (golfEve ? queue.find((s) => golfSafeSlot(s, entries, exercisesById)) : undefined) ??
    (queue[0] as DaySlot);
  return { first, rest: rotation.order.filter((s) => s !== first), golfEve };
}

/** This block's sessions in the shape the forecast wants. */
export async function readRotationSessions(blockId: string): Promise<{ date: string; slot: DaySlot }[]> {
  const rows = await db.session.where('blockId').equals(blockId).toArray();
  return rows.map((row) => ({ date: row.date, slot: row.daySlot as DaySlot }));
}

/** Everything the forecast needs for one block, read from the database. */
export async function readForecastInput(
  blockId: string,
  exercisesById: Map<string, Exercise>,
): Promise<Omit<ForecastInput, 'weekDates'> | undefined> {
  const rotation = await readRotation(blockId);
  if (!rotation) return undefined;
  const { readPlans } = await import('./program');
  const { readTraining } = await import('../db/settings');
  const [sessions, dates, entries, golf, training] = await Promise.all([
    readRotationSessions(blockId),
    readPlans().then((all) => all[blockId] ?? {}),
    db.blockExercise.where('blockId').equals(blockId).toArray(),
    db.golfDay.toArray().then((rows) => rows.map((row) => ({ date: row.date }))),
    readTraining(),
  ]);
  return { rotation, sessions, dates, entries, exercisesById, golf, golfWeekdays: training.golfWeekdays as Weekday[] };
}
