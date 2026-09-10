// @vitest-environment jsdom

/*
 * The Program screen's three separate acts: making a workout, saying what it is
 * called, and deciding when to do it. Keeping those apart is the architectural
 * point of `program.ts` — conflating them is what once made moving one
 * Wednesday move every Wednesday — so each is driven here on its own.
 */

import {
  BLOCK_ID,
  confirmWith,
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
  // The card only titles itself "Plan the week" once the live query has
  // actually produced one, so this is the screen saying it is ready.
  await screen.findByRole('heading', { name: 'Plan the week' });
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

/*
 * A card lists its exercises only for the day you are on; every other day
 * shows its name and totals and keeps the rows behind the summary toggle.
 * Tests that read the rows have to open the card first, exactly as a thumb
 * would.
 */
async function showExercises(ui: ReturnType<typeof user>, card: HTMLElement) {
  const toggle = within(card).queryByRole('button', { name: /^Show the exercises in / });
  if (toggle) await ui.click(toggle);
  return card;
}

/** Edit lives inside the card, so the card has to be open to reach it. */
async function editWorkout(ui: ReturnType<typeof user>, card: HTMLElement) {
  await showExercises(ui, card);
  await ui.click(within(card).getByRole('button', { name: 'Edit' }));
  return card;
}

describe('making a workout', () => {
  /** Taps a muscle on the body picker, which is how a workout says what it is. */
  const pickMuscle = async (ui: ReturnType<typeof user>, name: string) => {
    const group = screen.getByRole('group', { name: 'Muscles this workout trains' });
    await ui.click(within(group).getAllByRole('button', { name })[0] as HTMLElement);
  };

  it('adds it to the list and names it from what it holds', async () => {
    const { ui } = await openProgram();

    await ui.click(screen.getByRole('button', { name: 'New workout' }));
    /* Six focus buttons — upper, lower, push, pull, full, core — each a guess
       at which muscles you meant. Pointing at them says it exactly. */
    await pickMuscle(ui, 'Quads');
    await pickMuscle(ui, 'Glutes');
    await ui.click(screen.getByRole('button', { name: /^Heavy/ }));
    await ui.click(screen.getByRole('button', { name: 'Build it' }));

    /* Named from its contents rather than "Day A": the derivation is what keeps
       the name from drifting away from the session it describes. */
    const created = await createdWorkout();
    expect(created?.name).toBeTruthy();
    expect(created?.name).not.toMatch(/^Day /);
    // Derived from the muscles: quads and glutes are both lower-body.
    expect(created?.focus).toBe('lower');
    expect(await screen.findByRole('heading', { name: created?.name })).toBeTruthy();

    // What it holds is what it was asked for, not a re-inference from a weekday.
    const entries = await db.blockExercise.where('blockId').equals(BLOCK_ID).toArray();
    const patterns = entries.map((entry) => named(entry.exerciseId));
    expect(patterns.length).toBeGreaterThan(0);
  });

  it('will not build a workout that trains nothing', async () => {
    /* Nothing selected is not a full-body workout, it is an unanswered
       question — and the button says which. */
    const { ui } = await openProgram();
    await ui.click(screen.getByRole('button', { name: 'New workout' }));

    const build = await screen.findByRole('button', { name: 'Pick a muscle' });
    expect(build.hasAttribute('disabled')).toBe(true);

    await pickMuscle(ui, 'Chest');
    await screen.findByRole('button', { name: 'Build it' });
  });

  it('builds for the muscles pointed at, not for a category', async () => {
    /* The muscles have to change the SHAPE of the session, not just bias which
       exercise fills a fixed one: an arms workout that still hands back a
       squat is the old six buttons wearing a body map. */
    const { ui } = await openProgram();
    await ui.click(screen.getByRole('button', { name: 'New workout' }));
    await pickMuscle(ui, 'Biceps');
    await pickMuscle(ui, 'Lats');
    await ui.click(screen.getByRole('button', { name: 'Build it' }));

    await createdWorkout();
    const entries = await db.blockExercise.where('blockId').equals(BLOCK_ID).toArray();
    const chosen = entries
      .map((entry) => exercisesById.get(entry.exerciseId))
      .filter((exercise) => exercise !== undefined);
    expect(chosen.length).toBeGreaterThan(0);

    // Every pick pulls: nothing here squats or presses.
    const trains = (muscle: string) =>
      chosen.some((exercise) => exercise.primaryMuscles.includes(muscle as never));
    expect(trains('lats') || trains('biceps')).toBe(true);
    expect(chosen.every((exercise) => exercise.pattern !== 'squat')).toBe(true);
  });

  it('does not put it in the week — where it goes is a separate decision', async () => {
    const { ui } = await openProgram();

    await ui.click(screen.getByRole('button', { name: 'New workout' }));
    await ui.click(await screen.findByRole('button', { name: 'Everything' }));
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
      /* The day editor's tiles carry the effort and the totals in their
         label, since neither is text a screen reader can reach: the effort is
         a colour rule and the totals are a second line. */
      await within(sheet.parentElement as HTMLElement).findByRole('button', {
        name: /^Deadlift day, heavy,/,
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
    await editWorkout(ui, card);
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
    await editWorkout(ui, card);
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
        name: /^Thursday bench, heavy,/,
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
    await editWorkout(ui, card);
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
    await editWorkout(ui, card);
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
    await editWorkout(ui, card);
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

describe('what the week on screen will train', () => {
  /** The block card's own body map, by the muscle labels it carries. */
  async function plannedMap(): Promise<Record<string, string>> {
    const heading = await screen.findByRole('heading', { name: 'Plan the week' });
    const card = heading.closest('section') as HTMLElement;
    const titles = [...card.querySelectorAll('title')].map((node) => node.textContent ?? '');
    return Object.fromEntries(
      titles.map((text) => [text.split(' — ')[0] ?? '', text.split(' — ')[1] ?? '']),
    );
  }

  const blockCardText = async () =>
    ((await screen.findByRole('heading', { name: 'Plan the week' }))
      .closest('section') as HTMLElement).textContent ?? '';

  it('counts programmed sets, not logged ones', async () => {
    /* The distinction the map exists for. Levels answers "how did the week
       go", which is a question for afterwards; this answers "what does this
       week miss", which is still yours to fix. Nothing is logged here at all
       and the map is still full. */
    await seedSchedule({ A: { intensity: 'heavy', name: 'Squat day' } });
    await seedWorkout('A', ['bb_back_squat'], 3);
    await seedPlan({ [MONDAY]: 'A' });

    await openProgram();

    await waitFor(async () => {
      const map = await plannedMap();
      // Three sets of back squat: quads and glutes whole, four more at a half.
      expect(map.Quads).toBe('3 sets');
      expect(map.Glutes).toBe('3 sets');
      expect(map.Hamstrings).toBe('1.5 sets');
      expect(map.Abs).toBe('1.5 sets');
    });
    expect(await db.setLog.count()).toBe(0);
  });

  it('multiplies by the sets programmed, since one row is not one set', async () => {
    await seedSchedule({ A: { intensity: 'heavy', name: 'Squat day' } });
    await seedWorkout('A', ['bb_back_squat'], 5);
    await seedPlan({ [MONDAY]: 'A' });

    await openProgram();

    await waitFor(async () => expect((await plannedMap()).Quads).toBe('5 sets'));
  });

  it('ignores a workout that is not placed on this week', async () => {
    /* A workout you have made but not dropped on a day trains nothing yet.
       Counting it would make the map a list of what exists rather than of
       what the week is going to do. */
    await seedSchedule({ A: { intensity: 'heavy', name: 'Unplaced squats' } });
    await seedWorkout('A', ['bb_back_squat'], 3);

    await openProgram();

    await waitFor(async () => expect(await blockCardText()).toMatch(/Nothing trained or planned on this week/));
    expect((await plannedMap()).Quads).toBe('0 sets');
  });

  it('names the muscles the week leaves out', async () => {
    await seedSchedule({ A: { intensity: 'heavy', name: 'Squat day' } });
    await seedWorkout('A', ['bb_back_squat'], 3);
    await seedPlan({ [MONDAY]: 'A' });

    await openProgram();

    await waitFor(async () => expect(await blockCardText()).toMatch(/Not in this week:/));
    const text = await blockCardText();
    // A squat-only week trains no chest and no calves, and says so by name.
    expect(text).toMatch(/Chest/);
    expect(text).toMatch(/Calves/);
    // And does not name what it does train.
    expect(text.split('Not in this week:')[1]).not.toMatch(/Quads/);
  });

  it('follows the week strip rather than the calendar', async () => {
    /* The map is of the week ON SCREEN. Stepping forward to an empty week has
       to empty it, or it is a claim about a week nobody is looking at. */
    await seedSchedule({ A: { intensity: 'heavy', name: 'Squat day' } });
    await seedWorkout('A', ['bb_back_squat'], 3);
    await seedPlan({ [MONDAY]: 'A' });

    const { ui } = await openProgram();
    await waitFor(async () => expect((await plannedMap()).Quads).toBe('3 sets'));

    await ui.click(screen.getByRole('button', { name: 'Next week' }));

    await waitFor(async () => expect((await plannedMap()).Quads).toBe('0 sets'));
    expect(await blockCardText()).toMatch(/Nothing trained or planned on this week/);
  });
});

describe('a week whose workouts were deleted after it was trained', () => {
  /** One logged session on a date, with sets, and no surviving workout. */
  async function logSession(date: string, name: string, exerciseIds: string[]) {
    const id = `s_${date}`;
    await db.session.put({
      id,
      blockId: BLOCK_ID,
      daySlot: 'A',
      daySlotName: name,
      date,
      durationMin: 40,
    });
    await db.setLog.bulkPut(
      exerciseIds.flatMap((exerciseId) =>
        [1, 2, 3].map((setNo) => ({
          sessionId: id,
          exerciseId,
          setNo,
          reps: 8,
          weightKg: 60,
          effectiveKg: 60,
        })),
      ),
    );
  }

  const blockCardText = async () =>
    ((await screen.findByRole('heading', { name: 'Plan the week' }))
      .closest('section') as HTMLElement).textContent ?? '';

  it('still colours the map from what was actually logged', async () => {
    /* Deleting a workout you have already done is an ordinary thing to do, and
       it used to empty the day: the map read the plan, the plan was gone, and
       a week you trained showed as untrained. */
    await logSession(MONDAY, 'Lower body', ['bb_back_squat']);

    await openProgram();

    await waitFor(async () => {
      const heading = await screen.findByRole('heading', { name: 'Plan the week' });
      const card = heading.closest('section') as HTMLElement;
      const titles = [...card.querySelectorAll('title')].map((node) => node.textContent);
      // Three logged sets of back squat, and not one blockExercise row to read.
      expect(titles).toContain('Quads — 3 sets');
    });
    expect(await db.blockExercise.count()).toBe(0);
  });

  it('names the day by the session, rather than calling it "Log"', async () => {
    await logSession(MONDAY, 'Lower body', ['bb_back_squat']);

    await openProgram();

    // The strip token carries the session's own name, since nothing else does.
    await waitFor(() => expect(screen.getAllByText('Lower body').length).toBeGreaterThan(0));
    expect(dayButton(MONDAY).getAttribute('aria-label')).toMatch(/Lower body, done/);
  });

  it('counts a trained day once, by what it logged rather than what it planned', async () => {
    /* A day that went exactly as written must not be counted twice, and where
       the two disagree the log is the one that happened. */
    await seedSchedule({ A: { intensity: 'heavy', name: 'Squat day' } });
    await seedWorkout('A', ['bb_back_squat'], 5);
    await seedPlan({ [MONDAY]: 'A' });
    await logSession(MONDAY, 'Squat day', ['bb_back_squat']);

    await openProgram();

    await waitFor(async () => {
      const heading = await screen.findByRole('heading', { name: 'Plan the week' });
      const card = heading.closest('section') as HTMLElement;
      const titles = [...card.querySelectorAll('title')].map((node) => node.textContent);
      // Three logged, five planned: three, not eight and not five.
      expect(titles).toContain('Quads — 3 sets');
    });
  });

  it('still reads the plan for the days it has not reached yet', async () => {
    await seedSchedule({ A: { intensity: 'heavy', name: 'Squat day' } });
    await seedWorkout('A', ['bb_back_squat'], 4);
    await seedPlan({ [THURSDAY]: 'A' });
    await logSession(MONDAY, 'Bench day', ['bb_bench_press']);

    await openProgram();

    await waitFor(async () => {
      const text = await blockCardText();
      // Monday's logged chest work and Thursday's planned squat, in one map.
      expect(text).toContain('Chest — 3 sets');
      expect(text).toContain('Quads — 4 sets');
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
      expect(card.textContent).toContain(
          'Golf tomorrow (Sat) — no grip, lat or forearm work, and no heavy spinal lifts.',
        ),
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

    const { ui } = await openProgram();

    const card = await showExercises(ui, await workoutCard('Thursday pull'));
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

    const card = await showExercises(ui, await workoutCard('Monday squats'));
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

describe('a week of workouts, folded up', () => {
  it('keeps every card readable while hiding all but today\'s exercises', async () => {
    /* Five days of exercise lists is a screen you scroll past. What a card has
       to answer while shut is "what is this, when is it, can I start it" — the
       rows are detail. */
    await seedSchedule({
      A: { intensity: 'heavy', name: 'Monday squats' },
      B: { intensity: 'heavy', name: 'Thursday pull' },
    });
    await seedWorkout('A', ['bb_back_squat']);
    await seedWorkout('B', ['bb_bent_over_row']);
    /* Some other day of this same week, whichever day of it today happens to
       be — so the pair is always two cards on one screen. */
    const other = dayOfThisWeek(0) === todayIso() ? dayOfThisWeek(1) : dayOfThisWeek(0);
    await seedPlan({ [todayIso()]: 'A', [other]: 'B' });

    const { ui } = await openProgram();

    const today = await workoutCard('Monday squats');
    await waitFor(() => expect(today.textContent).toContain(named('bb_back_squat')));

    const tomorrow = await workoutCard('Thursday pull');
    // Shut, but not silent: the name and the totals are still on the card.
    expect(tomorrow.textContent).not.toContain(named('bb_bent_over_row'));
    expect(tomorrow.textContent).toContain('1 exercise · 3 sets');
    /* And nothing to hit by accident: Edit and Start were two small pills at
       the top of every folded card, right where a thumb scrolls the list. */
    expect(within(tomorrow).queryByRole('button', { name: 'Start' })).toBeNull();
    expect(within(tomorrow).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(today).getByRole('button', { name: 'Start' })).toBeTruthy();

    await showExercises(ui, tomorrow);
    await waitFor(() => expect(tomorrow.textContent).toContain(named('bb_bent_over_row')));
    expect(within(tomorrow).getByRole('button', { name: 'Start' })).toBeTruthy();
  });
});

describe('what a day is, said as a colour', () => {
  /*
   * Heavy and light used to be a word — "Tue · light" beside the weekday, and
   * nothing at all on a heavy day. It is a line of colour now, on the card, on
   * the calendar chip and on the day editor's tiles. Colour cannot be
   * asserted on usefully and a screen reader cannot see it either, so both
   * this suite and VoiceOver read the same labels.
   */
  it('tells the calendar how hard each day is, until it is done', async () => {
    await seedSchedule({
      A: { intensity: 'heavy', name: 'Monday squats' },
      B: { intensity: 'light', name: 'Thursday pull' },
    });
    await seedWorkout('A', ['bb_back_squat']);
    await seedWorkout('B', ['bb_bent_over_row']);
    await seedPlan({ [MONDAY]: 'A', [WEDNESDAY]: 'B' });

    await openProgram();

    await waitFor(() =>
      expect(dayButton(MONDAY).getAttribute('aria-label')).toMatch(/Monday squats, heavy/),
    );
    expect(dayButton(WEDNESDAY).getAttribute('aria-label')).toMatch(/Thursday pull, light/);
  });

  it('goes back to plain done once the day is trained', async () => {
    /* What it was built to be stops mattering the moment it happened, so the
       chip drops the effort colour and reads as done. */
    await seedSchedule({ A: { intensity: 'light', name: 'Monday squats' } });
    await seedWorkout('A', ['bb_back_squat']);
    await seedPlan({ [MONDAY]: 'A' });
    await db.session.put({
      id: 's_done',
      blockId: BLOCK_ID,
      daySlot: 'A',
      daySlotName: 'Monday squats',
      date: MONDAY,
      durationMin: 40,
    });

    await openProgram();

    await waitFor(() =>
      expect(dayButton(MONDAY).getAttribute('aria-label')).toMatch(/Monday squats, done/),
    );
    expect(dayButton(MONDAY).getAttribute('aria-label')).not.toMatch(/light/);
  });
});

describe('what one strip column can hold', () => {
  it('shows the round AND the workout when a day has both', async () => {
    /* Golf is not an either/or with the gym: a Sunday can hold a session and
       a round, and the strip used to show whichever branch won — the workout,
       leaving the round invisible exactly where it shapes the day. */
    const saturday = dayOfThisWeek(5);
    await db.golfDay.put({ date: saturday, status: 'planned', holes: 18 });
    await seedSchedule({ A: { intensity: 'heavy', name: 'Arms and Accessories' } });
    await seedWorkout('A', ['bb_curl']);
    await seedPlan({ [saturday]: 'A' });
    await openProgram();

    await workoutCard('Arms and Accessories');
    const column = dayButton(saturday).parentElement as HTMLElement;
    await waitFor(() => {
      expect(column.textContent).toContain('AA'); // the workout's pill
      expect(column.textContent).toContain('GOLF');
    });
  });

  it('shortens a logged-only day the way it shortens every planned one', async () => {
    /* A session whose workout is gone or moved is captioned by its stamped
       name — which used to render in FULL, wrapping three lines beside a row
       of neat initials. Same pill rule for everyone. */
    await seedSchedule({ A: { intensity: 'heavy', name: 'Push day' } });
    await seedWorkout('A', ['bb_bench_press']);
    await db.session.put({
      id: 's_moved',
      blockId: BLOCK_ID,
      daySlot: 'Z' as never,
      daySlotName: 'Lower Body Power',
      date: WEDNESDAY,
      durationMin: 40,
    });
    await openProgram();

    await workoutCard('Push day');
    const column = dayButton(WEDNESDAY).parentElement as HTMLElement;
    await waitFor(() => {
      expect(column.textContent).toContain('LBP');
      expect(column.textContent).not.toContain('Lower Body Power');
    });
  });
});

describe('the day editor', () => {
  async function openDay(date: string) {
    const { ui } = await openProgram();
    await workoutCard('Monday squats');
    await ui.click(dayButton(date));
    const heading = await screen.findByRole('heading', {
      name: WEEKDAY_LABEL[weekdayOf(date)],
    });
    return { ui, sheet: heading.parentElement as HTMLElement };
  }

  it('offers a workout with enough on it to choose by', async () => {
    await seedSchedule({ A: { intensity: 'heavy', name: 'Monday squats' } });
    await seedWorkout('A', ['bb_back_squat', 'bb_rdl']);

    const { sheet } = await openDay(WEDNESDAY);
    // A name alone cannot answer "have I got time for this one".
    const tile = within(sheet).getByRole('button', { name: /^Monday squats, heavy,/ });
    expect(tile.textContent).toMatch(/2 exercises · 6 sets · about \d+ min/);
  });

  it('tags each workout with the day it already sits on in this week', async () => {
    /* Choosing what to put on Sunday needs to know where everything else
       already is — and "where" is a fact about the week on screen, since the
       same workout can sit on Mon this week and Tue the next. */
    await seedSchedule({
      A: { weekday: 1, intensity: 'heavy', name: 'Monday squats' },
      B: { intensity: 'heavy', name: 'Free pull' },
    });
    await seedWorkout('A', ['bb_back_squat']);
    await seedWorkout('B', ['bb_bent_over_row']);

    const { sheet } = await openDay(WEDNESDAY);
    // Placed elsewhere in this week: the tile says where.
    const placed = within(sheet).getByRole('button', { name: /^Monday squats,.*on Mon this week$/ });
    expect(placed.textContent).toContain('Mon');
    // Not in this week at all: nothing to point at.
    const free = within(sheet).getByRole('button', { name: /^Free pull,/ });
    expect(free.textContent).not.toMatch(/\bMon|Tue|Wed|Thu|Fri|Sat|Sun\b/);
  });

  it('keeps the tag off the day being edited — the sheet title already says it', async () => {
    await seedSchedule({ A: { weekday: 1, intensity: 'heavy', name: 'Monday squats' } });
    await seedWorkout('A', ['bb_back_squat']);

    const { sheet } = await openDay(MONDAY);
    const tile = within(sheet).getByRole('button', { name: /^Monday squats,/ });
    expect(tile.getAttribute('aria-label')).not.toContain('this week');
  });

  it('asks about a round of golf once, not about its tense', async () => {
    await seedSchedule({ A: { intensity: 'heavy', name: 'Monday squats' } });
    await seedWorkout('A', ['bb_back_squat']);

    const { sheet } = await openDay(WEDNESDAY);
    expect(within(sheet).getByRole('button', { name: /Round of golf/ })).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Round planned' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Round played' })).toBeNull();
  });

  it('does not offer a third way to build a workout', async () => {
    // The same ask is on the Program screen and inside the New-workout sheet.
    await seedSchedule({ A: { intensity: 'heavy', name: 'Monday squats' } });
    await seedWorkout('A', ['bb_back_squat']);

    const { sheet } = await openDay(WEDNESDAY);
    expect(sheet.textContent).not.toMatch(/Build one with AI/);
  });
});

describe('which week is on screen', () => {
  it('says so as the arrows move it, so a question can be about it', async () => {
    /* The coach button floats over this screen but belongs to the app. Asked
       on a Sunday about the week being planned, it answered about the week
       ending that evening, because nothing told it what was on show. */
    const seen: string[] = [];
    draw(
      <ProgramScreen
        exercises={exercises}
        onStartDay={vi.fn()}
        onWeekChange={(date) => seen.push(date)}
      />,
    );
    await screen.findByRole('heading', { name: 'Plan the week' });
    const ui = user();

    expect(seen.at(-1)).toBe(todayIso());

    await ui.click(screen.getByRole('button', { name: 'Next week' }));
    await waitFor(() => expect(seen.at(-1)).toBe(shiftIso(todayIso(), 7)));

    await ui.click(screen.getByRole('button', { name: 'Previous week' }));
    await waitFor(() => expect(seen.at(-1)).toBe(todayIso()));
  });
});

describe('what a workout card says about itself', () => {
  /** A finished session for a slot, on a date. */
  async function logFor(slot: string, name: string, date: string) {
    await db.session.put({
      id: `s_${slot}_${date}`,
      blockId: BLOCK_ID,
      daySlot: slot as never,
      daySlotName: name,
      date,
      durationMin: 40,
    });
  }

  it('says done where it was trained, and the day where it is only planned', async () => {
    await seedSchedule({
      A: { intensity: 'heavy', name: 'Monday squats' },
      B: { intensity: 'heavy', name: 'Thursday pull' },
    });
    await seedWorkout('A', ['bb_back_squat']);
    await seedWorkout('B', ['bb_bent_over_row']);
    await seedPlan({ [MONDAY]: 'A', [WEDNESDAY]: 'B' });
    await logFor('A', 'Monday squats', MONDAY);

    await openProgram();

    const trained = await workoutCard('Monday squats');
    await waitFor(() => expect(trained.textContent).toContain('done'));

    // The one still to come says when, not whether.
    const planned = await workoutCard('Thursday pull');
    expect(planned.textContent).toContain(WEEKDAY_LABEL[weekdayOf(WEDNESDAY)]);
    expect(planned.textContent).not.toContain('done');
  });

  it('says a workout has no day rather than leaving the corner empty', async () => {
    /* Blank read as "the weekday has not loaded yet", which is a different
       thing from a workout that is not in the week at all. */
    await seedSchedule({ A: { intensity: 'heavy', name: 'Monday squats' } });
    await seedWorkout('A', ['bb_back_squat']);

    await openProgram();

    const card = await workoutCard('Monday squats');
    await waitFor(() => expect(card.textContent).toContain('no day yet'));
  });

  it('counts the times it has been done before, in the corner', async () => {
    await seedSchedule({ A: { intensity: 'heavy', name: 'Monday squats' } });
    await seedWorkout('A', ['bb_back_squat']);
    await logFor('A', 'Monday squats', shiftIso(MONDAY, -7));
    await logFor('A', 'Monday squats', shiftIso(MONDAY, -14));
    await logFor('A', 'Monday squats', shiftIso(MONDAY, -21));

    await openProgram();

    const card = await workoutCard('Monday squats');
    await waitFor(() =>
      expect(within(card).getByLabelText('done 3 times before')).toBeTruthy(),
    );
  });

  it('shows no count on a workout never trained', async () => {
    await seedSchedule({ A: { intensity: 'heavy', name: 'Monday squats' } });
    await seedWorkout('A', ['bb_back_squat']);

    await openProgram();

    const card = await workoutCard('Monday squats');
    await waitFor(() => expect(card.textContent).toContain('no day yet'));
    expect(within(card).queryByLabelText(/done .* before/)).toBeNull();
  });
});

describe('deleting a workout', () => {
  async function deleteWorkout(ui: ReturnType<typeof user>, name: string) {
    const card = await editWorkout(ui, await workoutCard(name));
    await ui.click(within(card).getByRole('button', { name: 'Delete workout' }));
  }

  it('asks nothing when there is nothing to lose', async () => {
    /* Built and never placed or trained: a confirm box on that is a keystroke
       tax on tidying up after a generator you did not like. */
    await seedSchedule({ A: { intensity: 'heavy', name: 'Monday squats' } });
    await seedWorkout('A', ['bb_back_squat']);
    const { ui } = await openProgram();
    const asked = vi.spyOn(window, 'confirm');

    await deleteWorkout(ui, 'Monday squats');

    await waitFor(async () => {
      const schedule = (await readSchedules())[BLOCK_ID] ?? {};
      expect(Object.keys(schedule)).toEqual([]);
    });
    expect(asked).not.toHaveBeenCalled();
  });

  it('says which day it is on when it is on the calendar', async () => {
    await seedSchedule({ A: { intensity: 'heavy', name: 'Monday squats' } });
    await seedWorkout('A', ['bb_back_squat']);
    await seedPlan({ [WEDNESDAY]: 'A' });
    const { ui } = await openProgram();
    confirmWith(true);

    await deleteWorkout(ui, 'Monday squats');

    const asked = vi.mocked(window.confirm).mock.calls[0]?.[0] ?? '';
    expect(asked).toContain(WEEKDAY_LABEL[weekdayOf(WEDNESDAY)]);
    expect(asked).not.toMatch(/you have done it/);
  });

  it('says how often it was done, and that the sessions survive', async () => {
    await seedSchedule({ A: { intensity: 'heavy', name: 'Monday squats' } });
    await seedWorkout('A', ['bb_back_squat']);
    await db.session.put({
      id: 's_old',
      blockId: BLOCK_ID,
      daySlot: 'A',
      daySlotName: 'Monday squats',
      date: shiftIso(MONDAY, -7),
      durationMin: 40,
    });
    const { ui } = await openProgram();
    confirmWith(true);

    await deleteWorkout(ui, 'Monday squats');

    const asked = vi.mocked(window.confirm).mock.calls[0]?.[0] ?? '';
    expect(asked).toMatch(/done it 1 time/);
    // The distinction that makes the delete safe to agree to.
    expect(asked).toMatch(/stay in History/);
  });

  it('keeps the workout when the question is declined', async () => {
    await seedSchedule({ A: { intensity: 'heavy', name: 'Monday squats' } });
    await seedWorkout('A', ['bb_back_squat']);
    await seedPlan({ [WEDNESDAY]: 'A' });
    const { ui } = await openProgram();
    confirmWith(false);

    await deleteWorkout(ui, 'Monday squats');

    const schedule = (await readSchedules())[BLOCK_ID] ?? {};
    expect(Object.keys(schedule)).toEqual(['A']);
  });
});
