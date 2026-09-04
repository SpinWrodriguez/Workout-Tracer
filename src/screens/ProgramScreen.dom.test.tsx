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
  exercisesById,
  named,
  seedPlan,
  seedSchedule,
  seedWorkout,
  user,
  draw,
} from '../test/dom';

import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import type { BlockExercise } from '../db/types';
import { sessionMinutes } from '../lib/blockValidation';
import { shiftIso, todayIso, weekStart } from '../lib/format';
import { realMinutes, timeFactor } from '../lib/timeModel';
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
const FRIDAY = dayOfThisWeek(4);

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

describe('placement is one week, not every week', () => {
  it('does not give a generated workout a standing weekday', async () => {
    /* The bug this replaced: generating four days wrote a weekday onto each
       workout, and a weekday is the RECURRING address — so one press filled
       every week the block would ever have. */
    await seedSchedule({ A: { weekday: undefined, intensity: 'heavy', name: 'Monday squats' } });
    const { ui } = await openProgram();

    /* An empty workout being filled in. Shuffle and Regenerate are gone, so
       this is the only draw a card offers — and the only one that cannot
       replace exercises somebody chose. */
    const card = await workoutCard('Monday squats');
    await ui.click(within(card).getByRole('button', { name: 'Build this workout' }));

    await waitFor(async () => {
      const stored = (await readSchedules())[BLOCK_ID]?.A;
      expect(stored?.generated).toBe(true);
    });
    expect((await readSchedules())[BLOCK_ID]?.A?.weekday).toBeUndefined();
    // And nothing appeared on the calendar off the back of it.
    expect((await readPlans())[BLOCK_ID] ?? {}).toEqual({});
  });

  it('judges the golf rule by the date a workout sits on, not a stored weekday', async () => {
    /* A high-grip lift the day before a round is the thing this app exists to
       prevent. It has to keep working now that the weekday is derived from the
       calendar rather than stored on the workout. */
    const saturday = dayOfThisWeek(5);
    await db.golfDay.put({ date: saturday, status: 'planned', holes: 18 });
    await seedSchedule({ A: { intensity: 'heavy', name: 'Deadlift day' } });
    await seedWorkout('A', ['bb_deadlift']);
    const { ui } = await openProgram();

    // Unplaced: there is no date, so there is nothing to be clear of.
    expect(screen.queryByRole('heading', { name: 'Worth fixing' })).toBeNull();

    // Put it on the Friday before the round and the rule speaks.
    await ui.click(dayButton(FRIDAY));
    const sheet = await screen.findByRole('heading', {
      name: WEEKDAY_LABEL[weekdayOf(FRIDAY)],
    });
    await ui.click(
      await within(sheet.parentElement as HTMLElement).findByRole('button', {
        name: 'Deadlift day',
      }),
    );

    const problems = await screen.findByRole('heading', { name: 'Worth fixing' });
    expect((problems.closest('section') as HTMLElement).textContent).toMatch(/round/i);
  });

  it('builds a workout clear of grip work when its date sits before a round', async () => {
    /* Not merely flagged afterwards — excluded up front. The generator is told
       what the day allows, and the day is known from the DATE it is planned on
       in the week being looked at. */
    await db.golfDay.put({ date: dayOfThisWeek(5), status: 'planned', holes: 18 });
    await seedSchedule({ A: { intensity: 'heavy', name: 'Friday session' } });
    await seedPlan({ [FRIDAY]: 'A' });
    const { ui } = await openProgram();

    const card = await workoutCard('Friday session');
    await ui.click(within(card).getByRole('button', { name: 'Build this workout' }));

    await waitFor(async () => {
      const rows = await db.blockExercise.where('blockId').equals(BLOCK_ID).toArray();
      expect(rows.length).toBeGreaterThan(0);
    });
    const rows = await db.blockExercise.where('blockId').equals(BLOCK_ID).toArray();
    const grippy = rows.filter((row) => exercisesById.get(row.exerciseId)?.gripLoad === 'high');
    expect(grippy.map((row) => named(row.exerciseId))).toEqual([]);
  });
});

describe('the starter week', () => {
  it('is gone — the screen is workouts and a calendar', async () => {
    await openProgram();
    /* It made workouts AND placed them in one press, which is the conflation
       every other part of this screen was untangled to avoid. */
    for (const gone of [
      'Build a starter week',
      'Set up the days',
      'Fill the empty days',
      'Sessions per week',
      'Heavy days',
      'Session length',
    ]) {
      expect(screen.queryByText(gone)).toBeNull();
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

    /*
     * Blank means "describe yourself again", not a stored empty string — the day
     * goes back to being named after what is in it.
     *
     * Waited for on the SCREEN, not in the database. The stored name clears a
     * tick before useLiveQuery re-renders the card, so waiting on the row and
     * then asserting on the heading read the DOM one tick early — green here,
     * red in CI.
     */
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Monday squats' })).toBeNull(),
    );
    expect((await readSchedules())[BLOCK_ID]?.A?.name).toBeUndefined();
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

/*
 * Reordering is a drag and deleting is a swipe, and jsdom has neither. What it
 * can drive is the keyboard on the grip and the delete button sitting behind
 * the row — which is exactly why both exist: the gesture must not be the only
 * way in, for a test or for anyone not using a thumb.
 */
describe('reordering and removing an exercise', () => {
  const orderInDb = async () =>
    (await db.blockExercise.where('blockId').equals(BLOCK_ID).toArray())
      .sort((a, b) => a.order - b.order)
      .map((row) => row.exerciseId);

  /** A three-exercise workout, opened for editing. */
  async function openEditor() {
    await seedSchedule({ A: { weekday: undefined, intensity: 'heavy', name: 'Monday squats' } });
    await seedWorkout('A', ['bb_back_squat', 'bb_rdl', 'sm_calf_raise']);
    const { ui } = await openProgram();
    const card = await workoutCard('Monday squats');
    await ui.click(within(card).getByRole('button', { name: 'Edit' }));
    return { ui, card };
  }

  const gripFor = (card: HTMLElement, exerciseId: string) =>
    within(card).findByRole('button', { name: `Reorder ${named(exerciseId)}` });

  it('moves the exercise its grip belongs to, and leaves the rest in place', async () => {
    const { ui, card } = await openEditor();

    /* Focused the way a keyboard reaches it — by tabbing. A press of the
       grip cannot focus it: the drag handler calls preventDefault, which is
       what stops a drag from also selecting the page. */
    (await gripFor(card, 'bb_back_squat')).focus();
    await ui.keyboard('{ArrowDown}');

    /* The order is stored, not just shown: `order` is what every other screen
       reads the workout back in. */
    await waitFor(async () =>
      expect(await orderInDb()).toEqual(['bb_rdl', 'bb_back_squat', 'sm_calf_raise']),
    );
  });

  it('does not wrap the top row round to the bottom', async () => {
    const { ui, card } = await openEditor();

    /* Up from the first row has nowhere to go. Pressing down after it proves
       the press was a no-op rather than a move that went somewhere odd: a wrap
       would have left this order unreachable. */
    (await gripFor(card, 'bb_back_squat')).focus();
    await ui.keyboard('{ArrowUp}{ArrowDown}');

    await waitFor(async () =>
      expect(await orderInDb()).toEqual(['bb_rdl', 'bb_back_squat', 'sm_calf_raise']),
    );
  });

  it('deletes the exercise the uncovered button belongs to', async () => {
    const { ui, card } = await openEditor();

    await ui.click(
      within(card).getByRole('button', { name: `Delete ${named('bb_rdl')}` }),
    );

    /*
     * Removing is two writes — the delete, then a renumber of what is left —
     * and waiting only on the first let the second land in the NEXT test's
     * freshly cleared database. It showed up as a stray sm_calf_raise in a
     * test that never seeded one, which is the harness rule at the top of
     * src/test/dom.ts earning its keep for the fourth time: wait on what
     * finishes last.
     */
    await waitFor(async () => {
      const rows = await db.blockExercise.where('blockId').equals(BLOCK_ID).toArray();
      expect(rows.map((row) => row.exerciseId).sort()).toEqual([
        'bb_back_squat',
        'sm_calf_raise',
      ]);
      // Contiguous from zero: that is the renumber, and it writes last.
      expect(rows.map((row) => row.order).sort()).toEqual([0, 1]);
    });
  });
});

/*
 * Choosing an exercise, and finding out what it is before you choose it. Both
 * were reported from the phone: a ticked row in the picker took the tap and
 * did nothing, and the Program screen was the one place with no way to look a
 * movement up — which is the screen where knowing changes the choice.
 */
describe('picking and unpicking an exercise', () => {
  it('takes it out of the workout when it is already in', async () => {
    await seedSchedule({ A: { intensity: 'heavy', name: 'Monday squats' } });
    await seedWorkout('A', ['bb_back_squat', 'bb_rdl']);
    const { ui } = await openProgram();

    const card = await workoutCard('Monday squats');
    await ui.click(within(card).getByRole('button', { name: 'Edit' }));
    await ui.click(within(card).getByRole('button', { name: 'Add exercise' }));

    /* The tick is a promise that tapping does something. Before this it was
       wired to the same "add" handler, so a second tap was swallowed. */
    const row = await screen.findByRole('button', {
      name: new RegExp(`^${named('bb_back_squat')}`),
    });
    expect(row.getAttribute('aria-pressed')).toBe('true');
    await ui.click(row);

    await waitFor(async () => {
      const rows = await db.blockExercise.where('blockId').equals(BLOCK_ID).toArray();
      expect(rows.map((entry) => entry.exerciseId)).toEqual(['bb_rdl']);
    });
  });

  it('puts it back when it is tapped again', async () => {
    await seedSchedule({ A: { intensity: 'heavy', name: 'Monday squats' } });
    await seedWorkout('A', ['bb_rdl']);
    const { ui } = await openProgram();

    const card = await workoutCard('Monday squats');
    await ui.click(within(card).getByRole('button', { name: 'Edit' }));
    await ui.click(within(card).getByRole('button', { name: 'Add exercise' }));

    const row = await screen.findByRole('button', {
      name: new RegExp(`^${named('bb_back_squat')}`),
    });
    expect(row.getAttribute('aria-pressed')).toBe('false');
    await ui.click(row);

    await waitFor(async () => {
      const rows = await db.blockExercise.where('blockId').equals(BLOCK_ID).toArray();
      expect(rows.map((entry) => entry.exerciseId).sort()).toEqual(['bb_back_squat', 'bb_rdl']);
    });
  });
});

describe('the golf buffer, said out loud', () => {
  it('tells the card why its workout has no pulling in it', async () => {
    /* The rule strips grip work from anything built the day before a round and
       no screen mentioned it, so the session came back with no pulling and
       looked like a bad generator. */
    const saturday = dayOfThisWeek(5);
    await db.golfDay.put({ date: saturday, status: 'planned', holes: 18 });
    await seedSchedule({ A: { intensity: 'heavy', name: 'Friday push' } });
    await seedWorkout('A', ['bb_bench_press']);
    await seedPlan({ [FRIDAY]: 'A' });

    await openProgram();

    const card = await workoutCard('Friday push');
    await waitFor(() =>
      expect(card.textContent).toContain('Golf tomorrow (Sat) — no grip, lat or forearm work.'),
    );
  });

  it('says a day two out may cost the swing, without forbidding it', async () => {
    /* The buffer was three days, which took Wednesday, Thursday and Friday off
       a Saturday round. Two days out is now a session to train with a
       heads-up, and the wording has to say that rather than veto it. */
    await db.golfDay.put({ date: dayOfThisWeek(5), status: 'planned', holes: 18 });
    await seedSchedule({ A: { intensity: 'heavy', name: 'Thursday pull' } });
    await seedWorkout('A', ['bb_bent_over_row']);
    await seedPlan({ [THURSDAY]: 'A' });

    await openProgram();

    const card = await workoutCard('Thursday pull');
    await waitFor(() =>
      expect(card.textContent).toContain('Golf in 2 days (Sat) — may affect your swing.'),
    );
    expect(card.textContent).not.toContain('no grip');
    // And the high-grip row it was built with is still in the workout.
    expect(card.textContent).toContain(named('bb_bent_over_row'));
  });

  it('says nothing on a day the rule does not touch', async () => {
    await db.golfDay.put({ date: dayOfThisWeek(5), status: 'planned', holes: 18 });
    await seedSchedule({ A: { intensity: 'heavy', name: 'Monday squats' } });
    await seedWorkout('A', ['bb_back_squat']);
    await seedPlan({ [MONDAY]: 'A' });

    await openProgram();

    const card = await workoutCard('Monday squats');
    expect(card.textContent).not.toContain('no grip, lat or forearm work');
  });
});

describe('how long the workout takes', () => {
  /** A workout of three exercises, three sets each, on the card. */
  async function cardFor(name = 'Monday squats') {
    await seedSchedule({ A: { weekday: undefined, intensity: 'heavy', name } });
    await seedWorkout('A', ['bb_back_squat', 'bb_rdl', 'sm_calf_raise']);
    await openProgram();
    return workoutCard(name);
  }

  const entries = (targetSets = 3): BlockExercise[] =>
    ['bb_back_squat', 'bb_rdl', 'sm_calf_raise'].map((exerciseId, order) => ({
      blockId: BLOCK_ID,
      exerciseId,
      daySlot: 'A' as const,
      targetSets,
      repRangeLow: 8,
      repRangeHigh: 10,
      order,
    }));

  it('says what the day adds up to', async () => {
    /* Computed since the first generator and shown nowhere, so the question
       you actually ask before starting — have I got time for this — was the
       one the card could not answer. */
    const card = await cardFor();
    const minutes = sessionMinutes(entries(), exercisesById);
    await within(card).findByText(`3 exercises · 9 sets · about ${minutes} min`);
  });

  it('scales it by what sessions really take, not what the model assumes', async () => {
    /* Three real sessions at 70% of estimate, which is what the log said: a
       40-minute budget was buying 28 minutes. The number on the card has to
       be the one the clock will show. */
    const each = sessionMinutes([entries(3)[0] as BlockExercise], exercisesById);
    for (const day of [0, 1, 2]) {
      const id = `past_${day}`;
      await db.session.put({
        id,
        blockId: BLOCK_ID,
        daySlot: 'A',
        daySlotName: 'Lower',
        date: shiftIso(todayIso(), -7 - day),
        durationMin: Math.round(each * 0.7),
      });
      await db.setLog.bulkPut(
        [1, 2, 3].map((setNo) => ({
          sessionId: id,
          exerciseId: 'bb_back_squat',
          setNo,
          reps: 8,
          weightKg: 60,
          effectiveKg: 60,
        })),
      );
    }

    const card = await cardFor();
    const estimate = sessionMinutes(entries(), exercisesById);
    /* Through the library's own two functions, so what the card shows and what
       the generator built to cannot drift apart. */
    const factor = timeFactor(
      [0, 1, 2].map(() => ({ estimateMinutes: each, actualMinutes: Math.round(each * 0.7) })),
    );
    const expected = realMinutes(estimate, factor);
    await waitFor(() =>
      expect(card.textContent).toContain(`3 exercises · 9 sets · about ${expected} min`),
    );
    // And that is genuinely shorter than the model's own guess.
    expect(expected).toBeLessThan(estimate);
  });
});

describe('reading up on an exercise from the Program screen', () => {
  it('opens the detail sheet from a row of the workout', async () => {
    await seedSchedule({ A: { intensity: 'heavy', name: 'Monday squats' } });
    await seedWorkout('A', ['bb_back_squat']);
    const { ui } = await openProgram();

    const card = await workoutCard('Monday squats');
    await ui.click(
      within(card).getByRole('button', { name: `About ${named('bb_back_squat')}` }),
    );

    /* The cue is the part that is always there, mapped or not — so it is what
       proves the sheet actually opened rather than a photo that may not have
       been fetched. */
    expect(await screen.findByText('In this gym')).toBeTruthy();
    expect(
      await screen.findByRole('heading', { name: named('bb_back_squat') }),
    ).toBeTruthy();
  });
});
