// @vitest-environment jsdom

/*
 * Planning a week, driven end to end — deterministically, on the lifter's own
 * call: the AI week builder generated near-copies of what the shelf already
 * held, so planning is now placement. Each chosen day takes a workout whose
 * focus and effort match it; a day nothing matches is named, never papered
 * over. No model, no key, no stub: the whole path is real code.
 */

import {
  BLOCK_ID,
  exercises,
  seedPlan,
  seedSchedule,
  seedWorkout,
  user,
  draw,
} from '../test/dom';

import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { shiftIso, todayIso, weekStart } from '../lib/format';
import { WEEKDAY_LABEL, weekdayOf } from '../lib/golf';
import { readPlans } from '../lib/program';
import { ProgramScreen } from './ProgramScreen';

const dayOfThisWeek = (offset: number) => shiftIso(weekStart(todayIso()), offset);

async function openProgram() {
  const view = draw(<ProgramScreen exercises={exercises} onStartDay={vi.fn()} />);
  await screen.findByRole('heading', { name: 'Plan the week' });
  return { view, ui: user() };
}

/** Opens the planner and picks the given weekday offsets, Monday = 0. */
async function planDays(ui: ReturnType<typeof user>, offsets: number[]) {
  await ui.click(await screen.findByRole('button', { name: 'Plan the week' }));
  await screen.findByRole('heading', { name: 'Plan this week' });
  for (const offset of offsets) {
    await ui.click(await within(dayList()).findByRole('button', { name: dayLabel(offset) }));
  }
}

/*
 * The planner's own day list. Scoped because the week strip behind the sheet
 * labels its days exactly the same way, which is correct for a screen reader
 * and ambiguous for a query.
 */
const dayList = () => screen.getByRole('group', { name: 'Training days' });

/** How the planner names one day of the week on screen. */
function dayLabel(offset: number): RegExp {
  const date = dayOfThisWeek(offset);
  return new RegExp(`^${WEEKDAY_LABEL[weekdayOf(date)]} ${date}`);
}

describe('planning a week from the shelf', () => {
  it('places matching workouts onto the chosen days and closes', async () => {
    /* The sheet's defaults for two picked days are lower/heavy then
       upper/heavy — exactly what the shelf holds, so both days place. */
    await seedSchedule({
      A: { intensity: 'heavy', focus: 'lower', name: 'Leg Day' },
      B: { intensity: 'heavy', focus: 'upper', name: 'Upper Push' },
    });
    await seedWorkout('A', ['bb_back_squat', 'kb_goblet_squat']);
    await seedWorkout('B', ['bb_bench_press', 'cb_lateral_raise']);

    const { ui } = await openProgram();
    await planDays(ui, [0, 1]);
    await ui.click(screen.getByRole('button', { name: 'Plan 2 days' }));

    await waitFor(async () => {
      const plan = (await readPlans())[BLOCK_ID] ?? {};
      expect(plan[dayOfThisWeek(0)]).toBe('A');
      expect(plan[dayOfThisWeek(1)]).toBe('B');
    });
    // Fully planned, so the sheet is done and gone.
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Plan this week' })).toBeNull(),
    );
  });

  it('names the day nothing matches, and still places the rest', async () => {
    await seedSchedule({ A: { intensity: 'heavy', focus: 'lower', name: 'Leg Day' } });
    await seedWorkout('A', ['bb_back_squat']);

    const { ui } = await openProgram();
    await planDays(ui, [0, 1]); // day two defaults to upper/heavy — no match
    await ui.click(screen.getByRole('button', { name: 'Plan 2 days' }));

    /* The gap is the message: which day, and what it wanted. The sheet stays
       open, because the fix — build that workout — starts from here. */
    const tuesday = WEEKDAY_LABEL[weekdayOf(dayOfThisWeek(1))];
    await screen.findByText(new RegExp(`Placed 1.*${tuesday} needs a heavy Upper workout`));
    const plan = (await readPlans())[BLOCK_ID] ?? {};
    expect(plan[dayOfThisWeek(0)]).toBe('A');
    expect(plan[dayOfThisWeek(1)] ?? null).toBeNull();
  });

  it('keeps a grip-heavy workout off the day before a round', async () => {
    /* The rule the app exists for. The shelf does not outrank the calendar:
       a pull day full of grip work must not land on the Friday before a
       Saturday round, however well the focus matches. */
    await db.golfDay.put({ date: dayOfThisWeek(5), status: 'planned', holes: 18 });
    await seedSchedule({ A: { intensity: 'heavy', focus: 'pull', name: 'Grip Pull' } });
    await seedWorkout('A', ['bw_pull_up', 'bb_bent_over_row']);

    const { ui } = await openProgram();
    await planDays(ui, [4]);
    await ui.click(screen.getByRole('button', { name: 'Pull' }));
    await ui.click(screen.getByRole('button', { name: 'Plan 1 day' }));

    await screen.findByText(/needs a heavy Pull workout/);
    const plan = (await readPlans())[BLOCK_ID] ?? {};
    expect(plan[dayOfThisWeek(4)] ?? null).toBeNull();
  });

  it('does not offer a day with a round on it', async () => {
    await db.golfDay.put({ date: dayOfThisWeek(5), status: 'planned', holes: 18 });
    const { ui } = await openProgram();
    await ui.click(await screen.findByRole('button', { name: 'Plan the week' }));

    const button = await within(dayList()).findByRole('button', { name: dayLabel(5) });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('places a workout once — a second matching day is a named gap', async () => {
    await seedSchedule({ A: { intensity: 'heavy', focus: 'lower', name: 'Leg Day' } });
    await seedWorkout('A', ['bb_back_squat']);

    const { ui } = await openProgram();
    await planDays(ui, [0, 2]);
    // Point both days at the same shape the one workout has.
    const lowers = screen.getAllByRole('button', { name: 'Lower' });
    for (const chip of lowers) await ui.click(chip);
    const heavies = screen.getAllByRole('button', { name: 'Heavy' });
    for (const chip of heavies) await ui.click(chip);
    await ui.click(screen.getByRole('button', { name: 'Plan 2 days' }));

    await screen.findByText(/needs a heavy Lower workout/);
    const plan = (await readPlans())[BLOCK_ID] ?? {};
    const placed = [dayOfThisWeek(0), dayOfThisWeek(2)].filter((date) => plan[date] === 'A');
    expect(placed).toHaveLength(1);
  });

  it('replaces what was on a day rather than double-booking it', async () => {
    /* Monday already holds A; planning Monday again places the OTHER matching
       workout, because a workout already placed this week stays where it is —
       and planDate frees the old slot from the date it loses. */
    await seedSchedule({
      A: { intensity: 'heavy', focus: 'lower', name: 'Leg Day' },
      B: { intensity: 'heavy', focus: 'lower', name: 'Leg Day Two' },
    });
    await seedWorkout('A', ['bb_back_squat']);
    await seedWorkout('B', ['kb_goblet_squat']);
    await seedPlan({ [dayOfThisWeek(0)]: 'A' });

    const { ui } = await openProgram();
    await planDays(ui, [0]);
    await ui.click(screen.getByRole('button', { name: 'Plan 1 day' }));

    await waitFor(async () => {
      const plan = (await readPlans())[BLOCK_ID] ?? {};
      expect(plan[dayOfThisWeek(0)]).toBe('B');
    });
    const plan = (await readPlans())[BLOCK_ID] ?? {};
    expect(Object.values(plan).filter((slot) => slot === 'A')).toEqual([]);
  });
});
