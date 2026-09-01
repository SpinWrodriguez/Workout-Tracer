import { db } from '../db/db';
import type { BlockExercise, DaySlot } from '../db/types';
import { weekdayOf, type Weekday } from './golf';
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
  /** Only what is actually in this week. */
  days: PlannedDay[];
  /** Every workout that exists, this week's or not — for the start sheet. */
  all: PlannedDay[];
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

  /*
   * Resolve the week date by date rather than workout by workout. A workout's
   * usual weekday is only a default now, so asking "where does this one fall"
   * would miss the week where it was moved — asking "what is on this date"
   * cannot.
   */
  const weekDates = Array.from({ length: 7 }, (_, i) => shiftIso(from, i));
  const dateOf = new Map<DaySlot, string>();
  for (const date of weekDates) {
    const slot = slotForDate(plan.schedule, date, plan.dates);
    if (slot !== undefined && !dateOf.has(slot)) dateOf.set(slot, date);
  }

  const all: PlannedDay[] = slots
    .map((slot) => {
      const scheduled = plan.schedule[slot];
      const date = dateOf.get(slot);
      return {
        slot,
        // Where it is THIS week if it is in it, otherwise where it usually is.
        weekday: date ? weekdayOf(date) : scheduled?.weekday,
        intensity: scheduled?.intensity ?? ('heavy' as Intensity),
        entries: entriesForSlot(plan.entries, slot),
        date,
        done: loggedSlots.has(slot),
        name: scheduled?.name,
      };
    })
    // This week in date order; anything not in it trails behind.
    .sort((a, b) => (a.weekday ?? 99) - (b.weekday ?? 99) || a.slot.localeCompare(b.slot));

  /*
   * The dashboard is a view of THIS week. A workout with no day in it is a
   * thing you own, not a thing you are doing — listing it beside Monday's
   * session says the week contains something it does not.
   */
  const days = all.filter((day) => day.date !== undefined);

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
    all,
    next: (upcoming[0] ?? pending[0])?.slot,
    today,
    todaySlot: slotForDate(plan.schedule, today, plan.dates),
    scheduled: Object.keys(plan.schedule).length > 0,
  };
}
