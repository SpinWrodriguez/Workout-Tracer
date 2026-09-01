// @vitest-environment jsdom

/*
 * Building a week with a model, driven end to end. The model itself is the only
 * thing stubbed, and it is stubbed at `fetch` — so askModel, the schema parse,
 * the rep clamping, validation, the writes and the placement are all the real
 * code. A stub any higher up would be testing the test.
 */

import { BLOCK_ID, exercises, exercisesById, seedPlan, user, draw } from '../test/dom';

import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { writeApiKey } from '../lib/askModel';
import { shiftIso, todayIso, weekStart } from '../lib/format';
import { WEEKDAY_LABEL, weekdayOf } from '../lib/golf';
import { readPlans, readSchedules } from '../lib/program';
import { patternsForFocus, type WorkoutFocus } from '../lib/weekTemplate';
import { ProgramScreen } from './ProgramScreen';

const dayOfThisWeek = (offset: number) => shiftIso(weekStart(todayIso()), offset);

/**
 * Stands in for the model. Reads the focus the app demanded out of the request
 * and answers with exercises that actually match it, so the reply is the kind a
 * cooperating model would send and validation is exercised for real.
 */
function stubModel() {
  const asked: { focus?: WorkoutFocus; constraints: string[] }[] = [];

  const pickFor = (focus: WorkoutFocus, noHighGrip: boolean) => {
    const wanted = new Set<string>(patternsForFocus(focus));
    return [...exercisesById.values()]
      .filter(
        (exercise) =>
          wanted.has(exercise.pattern) &&
          !exercise.isMobility &&
          exercise.skillLevel !== 'advanced' &&
          (!noHighGrip || exercise.gripLoad !== 'high'),
      )
      /* One heavy spinal lift at most: two in a session is a lower-back
         stacking bug and the validator would rightly reject the reply. */
      .filter((exercise, index, all) =>
        exercise.spinalLoad !== 'high'
          ? true
          : all.findIndex((other) => other.spinalLoad === 'high') === index,
      )
      .slice(0, 4);
  };

  const fetchStub = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      messages: { content: string }[];
    };
    const sent = JSON.parse(String(body.messages[0]?.content)) as {
      constraints?: string[];
    };
    const constraints = sent.constraints ?? [];
    const focus = constraints
      .map((line) => /Return focus "([a-z]+)"/.exec(line)?.[1])
      .find((match): match is string => match !== undefined) as WorkoutFocus | undefined;
    const noHighGrip = constraints.some((line) => line.includes('gripLoad "high"'));
    asked.push({ focus, constraints });

    const chosen = pickFor(focus ?? 'full', noHighGrip);
    const reply = {
      name: undefined,
      focus: focus ?? 'full',
      intensity: constraints.some((line) => line.includes('light session')) ? 'light' : 'heavy',
      why: 'stub',
      exercises: chosen.map((exercise) => ({
        exerciseId: exercise.id,
        sets: 3,
        repLow: exercise.repMin,
        repHigh: exercise.repMax,
      })),
    };
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: JSON.stringify(reply) }] }),
      text: async () => '',
    } as unknown as Response;
  });

  vi.stubGlobal('fetch', fetchStub);
  return { asked, fetchStub };
}

beforeEach(() => {
  // A pasted key is the device transport, which is what makes the button exist.
  writeApiKey('sk-ant-test');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openProgram() {
  const view = draw(<ProgramScreen exercises={exercises} onStartDay={vi.fn()} />);
  await screen.findByRole('heading', { name: 'Current block' });
  return { view, ui: user() };
}

/** Opens the planner and picks the given weekday offsets, Monday = 0. */
async function planDays(ui: ReturnType<typeof user>, offsets: number[]) {
  await ui.click(await screen.findByRole('button', { name: 'Build the week with AI' }));
  await screen.findByRole('heading', { name: 'Build the week' });
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

describe('building a week with a model', () => {
  it('makes one workout per chosen day and puts each on its own date', async () => {
    stubModel();
    const { ui } = await openProgram();
    await planDays(ui, [0, 2, 3]);

    await ui.click(screen.getByRole('button', { name: 'Build 3 workouts' }));

    await waitFor(
      async () => {
        const plan = (await readPlans())[BLOCK_ID] ?? {};
        const placed = Object.entries(plan).filter(([, slot]) => slot !== null);
        expect(placed).toHaveLength(3);
      },
      { timeout: 8000 },
    );

    const plan = (await readPlans())[BLOCK_ID] ?? {};
    expect(plan[dayOfThisWeek(0)]).toBeTruthy();
    expect(plan[dayOfThisWeek(2)]).toBeTruthy();
    expect(plan[dayOfThisWeek(3)]).toBeTruthy();
    // Three distinct workouts, not one workout on three days.
    const slots = new Set([0, 2, 3].map((offset) => plan[dayOfThisWeek(offset)]));
    expect(slots.size).toBe(3);

    /* And none of them recurs: no workout gained a standing weekday, so next
       week is empty until it is planned. This is the whole bug this replaced. */
    const schedule = (await readSchedules())[BLOCK_ID] ?? {};
    expect(Object.values(schedule).map((day) => day?.weekday)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  }, 20000);

  it('asks for the effort and the focus that were chosen, and stores them', async () => {
    const { asked } = stubModel();
    const { ui } = await openProgram();
    await planDays(ui, [0]);

    await ui.click(screen.getByRole('button', { name: 'Light' }));
    await ui.click(screen.getByRole('button', { name: 'Pull' }));
    await ui.click(screen.getByRole('button', { name: 'Build 1 workout' }));

    await waitFor(async () => expect(Object.keys((await readSchedules())[BLOCK_ID] ?? {})).toHaveLength(1), {
      timeout: 8000,
    });

    // The requirement reached the model as a constraint, not a hint.
    expect(asked[0]?.focus).toBe('pull');
    expect(asked[0]?.constraints.join(' ')).toMatch(/light session/);
    // And what came back is stored as what was asked for.
    const stored = Object.values((await readSchedules())[BLOCK_ID] ?? {})[0];
    expect(stored?.focus).toBe('pull');
    expect(stored?.intensity).toBe('light');
  }, 20000);

  it('keeps grip work off a day inside the golf buffer', async () => {
    /* The rule the app exists for, now reached through the week planner: the
       day's date decides, and the model is told the prohibition with no reason
       attached so it cannot reason about the calendar and get it wrong. */
    const saturday = dayOfThisWeek(5);
    await db.golfDay.put({ date: saturday, status: 'planned', holes: 18 });
    const { asked } = stubModel();
    const { ui } = await openProgram();
    await planDays(ui, [3]);
    await ui.click(screen.getByRole('button', { name: 'Pull' }));
    await ui.click(screen.getByRole('button', { name: 'Build 1 workout' }));

    await waitFor(async () => expect(await db.blockExercise.count()).toBeGreaterThan(0), {
      timeout: 8000,
    });

    expect(asked[0]?.constraints.join(' ')).toMatch(/gripLoad "high"/);
    const rows = await db.blockExercise.toArray();
    const grippy = rows.filter((row) => exercisesById.get(row.exerciseId)?.gripLoad === 'high');
    expect(grippy).toEqual([]);
  }, 20000);

  it('does not offer a day with a round on it', async () => {
    await db.golfDay.put({ date: dayOfThisWeek(5), status: 'planned', holes: 18 });
    stubModel();
    const { ui } = await openProgram();
    await ui.click(await screen.findByRole('button', { name: 'Build the week with AI' }));

    const button = await within(dayList()).findByRole('button', { name: dayLabel(5) });
    expect(button.hasAttribute('disabled')).toBe(true);
  }, 20000);

  it('keeps the workouts it already built when a later day fails', async () => {
    const { fetchStub } = stubModel();
    let calls = 0;
    const original = fetchStub.getMockImplementation();
    fetchStub.mockImplementation(async (url: string, init?: RequestInit) => {
      calls += 1;
      if (calls > 1) {
        return { ok: false, status: 500, text: async () => 'upstream exploded' } as unknown as Response;
      }
      return (await original?.(url, init)) as Response;
    });

    const { ui } = await openProgram();
    await planDays(ui, [0, 2]);
    await ui.click(screen.getByRole('button', { name: 'Build 2 workouts' }));

    /* Three good sessions are not worth throwing away because a fourth failed,
       so the run stops and says where. */
    const message = await screen.findByText(/before it were kept|upstream|failed/i, {}, { timeout: 8000 });
    expect(message).toBeTruthy();

    const plan = (await readPlans())[BLOCK_ID] ?? {};
    const monday = plan[dayOfThisWeek(0)];
    expect(monday).toBeTruthy();
    expect(plan[dayOfThisWeek(2)] ?? null).toBeNull();
    // Kept means kept: the exercises are still there, not just the placement.
    const kept = await db.blockExercise.where('blockId').equals(BLOCK_ID).toArray();
    expect(kept.filter((row) => row.daySlot === monday).length).toBeGreaterThan(0);
    expect((await readSchedules())[BLOCK_ID]?.[monday as 'A']?.generated).toBe(true);
  }, 20000);

  it('replaces what was on a day rather than double-booking it', async () => {
    stubModel();
    await db.blockExercise.put({
      blockId: BLOCK_ID,
      exerciseId: 'bb_back_squat',
      daySlot: 'A',
      targetSets: 3,
      repRangeLow: 6,
      repRangeHigh: 10,
      order: 0,
    });
    await seedPlan({ [dayOfThisWeek(0)]: 'A' });
    const { ui } = await openProgram();
    await planDays(ui, [0]);
    await ui.click(screen.getByRole('button', { name: 'Build 1 workout' }));

    await waitFor(
      async () => expect(Object.keys((await readSchedules())[BLOCK_ID] ?? {}).length).toBe(1),
      { timeout: 8000 },
    );

    const plan = (await readPlans())[BLOCK_ID] ?? {};
    const monday = plan[dayOfThisWeek(0)];
    expect(monday).not.toBe('A');
    // The old workout keeps its exercises; it just has no day any more.
    const kept = await db.blockExercise.where('blockId').equals(BLOCK_ID).toArray();
    expect(kept.some((row) => row.daySlot === 'A')).toBe(true);
    expect(Object.values(plan).filter((slot) => slot === 'A')).toEqual([]);
  }, 20000);
});
