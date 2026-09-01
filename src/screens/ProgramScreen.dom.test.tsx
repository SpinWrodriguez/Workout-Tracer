// @vitest-environment jsdom

/*
 * The Program screen's three separate acts: making a workout, saying what it is
 * called, and deciding when to do it. Keeping those apart is the architectural
 * point of `program.ts` — conflating them is what once made moving one
 * Wednesday move every Wednesday — so each is driven here on its own.
 */

import {
  BLOCK_ID,
  exercises,
  named,
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
import { readPlans, readSchedules } from '../lib/program';
import { ProgramScreen } from './ProgramScreen';

/*
 * Dates are derived from the clock rather than written down, because the screen
 * anchors on today: a hardcoded Wednesday is a test that passes this week.
 */
const dayOfThisWeek = (offset: number) => shiftIso(weekStart(todayIso()), offset);
const MONDAY = dayOfThisWeek(0);
const WEDNESDAY = dayOfThisWeek(2);
const THURSDAY = dayOfThisWeek(3);

/** The week strip button for a date, by the label a screen reader would read. */
const dayButton = (date: string) =>
  screen.getByRole('button', {
    name: new RegExp(`^${WEEKDAY_LABEL[weekdayOf(date)]} ${date}`),
  });

async function openProgram() {
  const onStartDay = vi.fn();
  const view = draw(<ProgramScreen exercises={exercises} onStartDay={onStartDay} />);
  // The card only titles itself "Current block" once the live query has
  // actually produced one, so this is the screen saying it is ready.
  await screen.findByRole('heading', { name: 'Current block' });
  return { onStartDay, view, ui: user() };
}

/**
 * The card holding one workout, found by the name it is showing. Async because
 * the workouts arrive on a later tick than the block does.
 */
/*
 * Creating a workout writes the exercises and THEN the schedule entry, so
 * waiting on blockExercise races the second write. Wait for the entry itself.
 */
async function createdWorkout() {
  let created: NonNullable<ReturnType<typeof Object.values>>[number];
  await waitFor(async () => {
    const schedule = (await readSchedules())[BLOCK_ID] ?? {};
    expect(Object.keys(schedule)).toHaveLength(1);
    created = Object.values(schedule)[0];
  });
  return created as NonNullable<Awaited<ReturnType<typeof readSchedules>>[string]>['A'];
}

async function workoutCard(name: string | RegExp): Promise<HTMLElement> {
  const card = (await screen.findByRole('heading', { name })).closest('section');
  if (!card) throw new Error(`heading ${String(name)} is not inside a card`);
  return card;
}

describe('making a workout', () => {
  it('adds it to the list and names it from what it holds', async () => {
    const { ui } = await openProgram();

    await ui.click(screen.getByRole('button', { name: 'New workout' }));
    await ui.click(await screen.findByRole('button', { name: 'Lower' }));
    await ui.click(screen.getByRole('button', { name: /^Heavy/ }));
    await ui.click(screen.getByRole('button', { name: 'Build it' }));

    /* Named from its contents rather than "Day A": the derivation is what keeps
       the name from drifting away from the session it describes. */
    const created = await createdWorkout();
    expect(created?.name).toBeTruthy();
    expect(created?.name).not.toMatch(/^Day /);
    expect(created?.focus).toBe('lower');
    expect(await screen.findByRole('heading', { name: created?.name })).toBeTruthy();

    // What it holds is what it was asked for, not a re-inference from a weekday.
    const entries = await db.blockExercise.where('blockId').equals(BLOCK_ID).toArray();
    const patterns = entries.map((entry) => named(entry.exerciseId));
    expect(patterns.length).toBeGreaterThan(0);
  });

  it('does not put it in the week — where it goes is a separate decision', async () => {
    const { ui } = await openProgram();

    await ui.click(screen.getByRole('button', { name: 'New workout' }));
    await ui.click(await screen.findByRole('button', { name: /^Full body/ }));
    await ui.click(screen.getByRole('button', { name: 'Build it' }));

    const created = await createdWorkout();
    /* No standing weekday and no date entry: a workout you make is never placed
       for you. This is the half of the split that is easy to regress, because
       placing it would look helpful. */
    expect(created?.weekday).toBeUndefined();
    expect((await readPlans())[BLOCK_ID] ?? {}).toEqual({});

    // And it is not on any day of the strip either.
    for (let offset = 0; offset < 7; offset += 1) {
      expect(dayButton(dayOfThisWeek(offset)).getAttribute('aria-label')).not.toContain(
        created?.name,
      );
    }
  });
});

describe('renaming a workout', () => {
  it('keeps the typed name across a remount', async () => {
    await seedSchedule({ A: { weekday: 1, intensity: 'heavy', name: 'Monday squats' } });
    await seedWorkout('A', ['bb_back_squat', 'db_bench_press']);
    const { ui, view } = await openProgram();

    const card = await workoutCard('Monday squats');
    await ui.click(within(card).getByRole('button', { name: 'Edit' }));
    const field = await screen.findByRole('textbox', { name: 'Name' });
    await ui.clear(field);
    await ui.type(field, 'Squat and press');
    /* Committed on blur rather than per keystroke: writing every character back
       through the database made the field fight what was being typed into it. */
    await ui.tab();

    await waitFor(async () =>
      expect((await readSchedules())[BLOCK_ID]?.A?.name).toBe('Squat and press'),
    );

    // A remount is the real test: a name held only in component state would
    // survive the assertion above and vanish here.
    view.unmount();
    draw(<ProgramScreen exercises={exercises} onStartDay={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Squat and press' })).toBeTruthy();
  });

  it('clears the name back to the derived one when the field is emptied', async () => {
    await seedSchedule({ A: { weekday: 1, intensity: 'heavy', name: 'Monday squats' } });
    await seedWorkout('A', ['bb_back_squat']);
    const { ui } = await openProgram();

    const card = await workoutCard('Monday squats');
    await ui.click(within(card).getByRole('button', { name: 'Edit' }));
    await ui.clear(await screen.findByRole('textbox', { name: 'Name' }));
    await ui.tab();

    // Blank means "describe yourself again", not a stored empty string — the
    // day goes back to being named after what is in it.
    await waitFor(async () =>
      expect((await readSchedules())[BLOCK_ID]?.A?.name).toBeUndefined(),
    );
    expect(screen.queryByRole('heading', { name: 'Monday squats' })).toBeNull();
  });
});

describe('moving a session to another date', () => {
  /* Via the day editor rather than the drag: jsdom's pointer support is too
     weak for the drag path, and planDate is already unit-tested. */
  async function moveThursdayToWednesday() {
    await seedSchedule({
      A: { weekday: 1, intensity: 'heavy', name: 'Monday squats' },
      B: { weekday: 4, intensity: 'heavy', name: 'Thursday bench' },
    });
    await seedWorkout('A', ['bb_back_squat']);
    await seedWorkout('B', ['db_bench_press']);
    const opened = await openProgram();
    /* Both workouts on screen before touching the calendar: the day editor is
       handed the slots the block DEFINES, and opening it before that live query
       has landed offers an empty day. */
    await workoutCard('Monday squats');
    await workoutCard('Thursday bench');

    await opened.ui.click(dayButton(WEDNESDAY));
    const sheet = await screen.findByRole('heading', {
      name: WEEKDAY_LABEL[weekdayOf(WEDNESDAY)],
    });
    await opened.ui.click(
      await within(sheet.parentElement as HTMLElement).findByRole('button', {
        name: 'Thursday bench',
      }),
    );
    return opened;
  }

  it('records the move against that one date', async () => {
    await moveThursdayToWednesday();

    await waitFor(async () => {
      const plan = (await readPlans())[BLOCK_ID] ?? {};
      expect(plan[WEDNESDAY]).toBe('B');
    });
    // The standing arrangement is untouched: B still USUALLY falls on Thursday.
    expect((await readSchedules())[BLOCK_ID]?.B?.weekday).toBe(4);
  });

  it('leaves every other week alone', async () => {
    const { ui } = await moveThursdayToWednesday();
    await waitFor(async () => expect((await readPlans())[BLOCK_ID]?.[WEDNESDAY]).toBe('B'));

    // This week: Wednesday now carries it, Thursday does not.
    await waitFor(() =>
      expect(dayButton(WEDNESDAY).getAttribute('aria-label')).toContain('Thursday bench'),
    );
    expect(dayButton(THURSDAY).getAttribute('aria-label')).not.toContain('Thursday bench');

    await ui.click(screen.getByRole('button', { name: 'Next week' }));

    // Next week: back on Thursday, because a date entry is one week's decision
    // and not a change to the pattern. This is the bug the DatePlan layer
    // exists to prevent.
    const nextThursday = shiftIso(THURSDAY, 7);
    const nextWednesday = shiftIso(WEDNESDAY, 7);
    await waitFor(() =>
      expect(dayButton(nextThursday).getAttribute('aria-label')).toContain('Thursday bench'),
    );
    expect(dayButton(nextWednesday).getAttribute('aria-label')).not.toContain('Thursday bench');
    // And the Monday workout never moved at all.
    expect(dayButton(shiftIso(MONDAY, 7)).getAttribute('aria-label')).toContain('Monday squats');
  });
});

describe('fixing a rule violation', () => {
  it('offers the drop and clears once it is applied', async () => {
    await seedSchedule({ A: { weekday: 1, intensity: 'heavy', name: 'Monday squats' } });
    /* Two heavy spinal-load lifts in one session: a lower-back stacking bug,
       and a rule that has to speak because the back pays for it days later. */
    await seedWorkout('A', ['bb_back_squat', 'bb_front_squat']);
    const { ui } = await openProgram();

    const card = (await screen.findByRole('heading', { name: 'Worth fixing' }))
      .closest('section') as HTMLElement;
    expect(card.textContent).toMatch(/heavy spinal-load lifts/);

    /* The later lift goes: the first heavy spinal lift of a session is the one
       it was built around. A fix that cannot say what it does is just bad news. */
    await ui.click(
      within(card).getByRole('button', { name: `Drop ${named('bb_front_squat')}` }),
    );

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Worth fixing' })).toBeNull());
    const remaining = await db.blockExercise.where('blockId').equals(BLOCK_ID).toArray();
    expect(remaining.map((row) => row.exerciseId)).toEqual(['bb_back_squat']);
  });
});
