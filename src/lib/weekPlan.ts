import { db } from '../db/db';
import type { BlockExercise, DaySlot } from '../db/types';
import { dateOfWeekday, type Weekday } from './golf';
import { shiftIso, todayIso, weekStart } from './format';
import { entriesForSlot, readBlockPlan, slotForDate } from './program';
import type { Intensity } from './weekTemplate';

/* -------------------------------------------------------------------------- */
/*  The week as something you can act on.                                     */
/*                                                                            */
/*  Which days exist, when each one falls, whether it has been done, and which */
/*  one you should be doing next. Shared because the dashboard and the start   */
/*  sheet must agree: two answers to "what is next" is worse than none.        */
/* -------------------------------------------------------------------------- */

export interface PlannedDay {
  slot: DaySlot;
  weekday?: Weekday;
  intensity: Intensity;
  entries: BlockExercise[];
  /** The date this day falls on in the current week, if it is scheduled. */
  date?: string;
  /** A session for this slot has already been logged this week. */
  done: boolean;
  /** A name the user typed, if any. */
  name?: string;
}

export interface WeekPlan {
  blockId: string;
  days: PlannedDay[];
  /** The soonest unfinished session — the one Start should point at. */
  next?: DaySlot;
  today: string;
  todaySlot?: DaySlot;
  scheduled: boolean;
}

export async function readWeekPlan(): Promise<WeekPlan | undefined> {
  const plan = await readBlockPlan();
  if (!plan) return undefined;

  const today = todayIso();
  const from = weekStart(today);
  const sessions = await db.session
    .where('date')
    .between(from, shiftIso(from, 7), true, false)
    .toArray();
  const loggedSlots = new Set(sessions.map((session) => session.daySlot));

  // Every slot the block defines, scheduled or not: a day with no weekday
  // still exists and still has to be startable.
  const slots = [
    ...new Set([
      ...plan.entries.map((entry) => entry.daySlot),
      ...(Object.keys(plan.schedule) as DaySlot[]),
    ]),
  ];

  const days: PlannedDay[] = slots
    .map((slot) => {
      const scheduled = plan.schedule[slot];
      return {
        slot,
        weekday: scheduled?.weekday,
        intensity: scheduled?.intensity ?? ('heavy' as Intensity),
        entries: entriesForSlot(plan.entries, slot),
        date: scheduled?.weekday ? dateOfWeekday(today, scheduled.weekday) : undefined,
        done: loggedSlots.has(slot),
        name: scheduled?.name,
      };
    })
    // Scheduled days in weekday order; anything unscheduled trails behind.
    .sort((a, b) => (a.weekday ?? 99) - (b.weekday ?? 99) || a.slot.localeCompare(b.slot));

  /*
   * The soonest unfinished session from today onward. Falling back to any
   * unfinished day keeps a week you have fallen behind on from offering
   * nothing at all, rather than silently pointing at next Monday.
   */
  const pending = days.filter((day) => !day.done && day.entries.length > 0);
  const upcoming = pending.filter((day) => day.date !== undefined && day.date >= today);

  return {
    blockId: plan.block.id,
    days,
    next: (upcoming[0] ?? pending[0])?.slot,
    today,
    todaySlot: slotForDate(plan.schedule, today),
    scheduled: Object.keys(plan.schedule).length > 0,
  };
}
