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

/*
 * The device key is the transport under test, so the relay is mocked away.
 * Without this the suite counts one call per week ON CI and two on a machine
 * with a real .env.local: the app tries the Edge Function first, the stub
 * answers in a shape supabase-js does not return, and the fallback to the
 * pasted key is a second fetch. A test that depends on whether the developer
 * has credentials on disk is a test that reports the wrong thing.
 */
vi.mock('../lib/supabaseSource', () => ({
  isSupabaseConfigured: () => false,
  getSupabase: async () => undefined,
}));

const dayOfThisWeek = (offset: number) => shiftIso(weekStart(todayIso()), offset);

/**
 * Stands in for the model. Reads the focus the app demanded out of the request
 * and answers with exercises that actually match it, so the reply is the kind a
 * cooperating model would send and validation is exercised for real.
 */
function stubModel() {
  const asked: { slots: { slot: number; focus: string; constraints: string[] }[] }[] = [];
  /** How many times the API was called. One week should be one call. */
  let calls = 0;

  const pickFor = (focus: string, noHighGrip: boolean, avoid: Set<string>) => {
    const wanted = new Set<string>(patternsForFocus(focus as WorkoutFocus));
    return [...exercisesById.values()]
      .filter(
        (exercise) =>
          wanted.has(exercise.pattern) &&
          !exercise.isMobility &&
          exercise.skillLevel !== 'advanced' &&
          !avoid.has(exercise.id) &&
          (!noHighGrip || exercise.gripLoad !== 'high'),
      )
      /* One heavy spinal lift at most: two in a session is a lower-back
         stacking bug and the validator would rightly reject it. */
      .filter((exercise, index, all) =>
        exercise.spinalLoad !== 'high'
          ? true
          : all.findIndex((other) => other.spinalLoad === 'high') === index,
      )
      .slice(0, 4);
  };

  const fetchStub = vi.fn(async (_url: string, init?: RequestInit) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    const sent = JSON.parse(String(body.messages[0]?.content)) as {
      slots?: { slot: number; focus: string; intensity: string; constraints: string[] }[];
    };
    const slots = sent.slots ?? [];
    asked.push({ slots });

    /* Nothing repeated between slots, which is what seeing the whole week at
       once is for — and what the prompt asks of a real model. */
    const used = new Set<string>();
    const workouts = slots.map((slot) => {
      const noHighGrip = slot.constraints.some((line) => line.includes('gripLoad "high"'));
      const chosen = pickFor(slot.focus, noHighGrip, used);
      for (const exercise of chosen) used.add(exercise.id);
      return {
        slot: slot.slot,
        name: null,
        focus: slot.focus,
        intensity: slot.intensity,
        exercises: chosen.map((exercise) => ({
          exerciseId: exercise.id,
          sets: 3,
          repLow: exercise.repMin,
          repHigh: exercise.repMax,
        })),
      };
    });

    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ workouts }) }],
      }),
      text: async () => '',
    } as unknown as Response;
  });

  vi.stubGlobal('fetch', fetchStub);
  return { asked, fetchStub, callCount: () => calls };
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

    await waitFor(
      async () => expect(Object.keys((await readPlans())[BLOCK_ID] ?? {})).not.toHaveLength(0),
      { timeout: 8000 },
    );

    // The requirement reached the model as a constraint, not a hint.
    expect(asked[0]?.slots[0]?.focus).toBe('pull');
    expect(asked[0]?.slots[0]?.constraints.join(' ')).toMatch(/light session/);
    // And what came back is stored as what was asked for.
    const stored = Object.values((await readSchedules())[BLOCK_ID] ?? {})[0];
    expect(stored?.focus).toBe('pull');
    expect(stored?.intensity).toBe('light');
  }, 20000);

  it('keeps grip work off a day inside the golf buffer', async () => {
    /* The rule the app exists for, now reached through the week planner: the
       day's date decides, and the model is told the prohibition with no reason
       attached so it cannot reason about the calendar and get it wrong.
       Friday, because the buffer is the day before a round — Thursday is
       allowed now and would prove nothing. */
    const saturday = dayOfThisWeek(5);
    await db.golfDay.put({ date: saturday, status: 'planned', holes: 18 });
    const { asked } = stubModel();
    const { ui } = await openProgram();
    await planDays(ui, [4]);
    await ui.click(screen.getByRole('button', { name: 'Pull' }));
    await ui.click(screen.getByRole('button', { name: 'Build 1 workout' }));

    await waitFor(
      async () => expect(Object.keys((await readPlans())[BLOCK_ID] ?? {})).not.toHaveLength(0),
      { timeout: 8000 },
    );

    expect(asked[0]?.slots[0]?.constraints.join(' ')).toMatch(/gripLoad "high"/);
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

  it('asks once for the whole week, however many days it is', async () => {
    /*
     * The point of the rewrite. One call per day meant four prefills of the
     * exercise library and four passes of thinking for a four-day week; the
     * lifter's wait scaled with the size of their week for no reason.
     */
    const { callCount, asked } = stubModel();
    const { ui } = await openProgram();
    await planDays(ui, [0, 2, 3]);

    await ui.click(screen.getByRole('button', { name: 'Build 3 workouts' }));

    await waitFor(
      async () => {
        const plan = (await readPlans())[BLOCK_ID] ?? {};
        expect(Object.values(plan).filter((slot) => slot !== null)).toHaveLength(3);
      },
      { timeout: 8000 },
    );

    expect(callCount()).toBe(1);
    // All three slots in the one request, numbered rather than dated.
    expect(asked[0]?.slots.map((slot) => slot.slot)).toEqual([1, 2, 3]);
  }, 20000);

  it('does not repeat exercises across the week', async () => {
    /* Seeing every day at once is what one call buys, beyond the speed: the
       day-by-day version only ever saw the days before it. */
    stubModel();
    const { ui } = await openProgram();
    await planDays(ui, [0, 2, 3]);
    await ui.click(screen.getByRole('button', { name: 'Build 3 workouts' }));

    /*
     * Waited on the PLAN, which is the last of the three writes. Waiting on
     * blockExercise let the test finish while writeSchedule and writePlan were
     * still in flight — they then landed in the NEXT test's freshly cleared
     * database and broke it. Wait on what finishes last.
     */
    await waitFor(
      async () => {
        const plan = (await readPlans())[BLOCK_ID] ?? {};
        expect(Object.values(plan).filter((slot) => slot !== null)).toHaveLength(3);
      },
      { timeout: 8000 },
    );

    const rows = await db.blockExercise.where('blockId').equals(BLOCK_ID).toArray();
    const ids = rows.map((row) => row.exerciseId);
    expect(new Set(ids).size).toBe(ids.length);
  }, 20000);

  it('keeps the days that passed when one of them cannot', async () => {
    /*
     * The day-by-day version kept the first three when the fourth failed, and
     * the one-call rewrite nearly lost that. Three good sessions are not worth
     * discarding because the fourth would not pass.
     */
    const { fetchStub } = stubModel();
    const original = fetchStub.getMockImplementation();
    fetchStub.mockImplementation(async (url: string, init?: RequestInit) => {
      const response = (await original?.(url, init)) as Response;
      const payload = (await response.json()) as {
        content: { text: string }[];
      };
      const parsed = JSON.parse(payload.content[0]?.text ?? '{}') as {
        workouts: { slot: number; exercises: unknown[] }[];
      };
      /* Slot 2 always comes back stacking two heavy spinal lifts, which the
         validator rejects every time — so it exhausts its attempts while
         slot 1 passes on the first. */
      for (const workout of parsed.workouts) {
        if (workout.slot !== 2) continue;
        workout.exercises = [
          { exerciseId: 'bb_back_squat', sets: 3, repLow: 6, repHigh: 10 },
          { exerciseId: 'bb_front_squat', sets: 3, repLow: 6, repHigh: 10 },
        ];
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: 'text', text: JSON.stringify(parsed) }],
        }),
        text: async () => '',
      } as unknown as Response;
    });

    const { ui } = await openProgram();
    await planDays(ui, [0, 2]);
    await ui.click(screen.getByRole('button', { name: 'Build 2 workouts' }));

    const message = await screen.findByText(/Built 1 of 2/i, {}, { timeout: 12000 });
    expect(message).toBeTruthy();

    // The day that worked is on the calendar, with its exercises.
    const plan = (await readPlans())[BLOCK_ID] ?? {};
    expect(plan[dayOfThisWeek(0)]).toBeTruthy();
    expect(plan[dayOfThisWeek(2)] ?? null).toBeNull();
    const rows = await db.blockExercise.where('blockId').equals(BLOCK_ID).toArray();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.daySlot === plan[dayOfThisWeek(0)])).toBe(true);
  }, 30000);

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

    /*
     * Wait on the PLAN, not the schedule. askOneWorkout writes the exercises,
     * then the schedule entry, then the placement — so waiting on the schedule
     * reads the plan mid-write, and the assertion below saw the old slot still
     * on Monday about one run in five.
     */
    await waitFor(
      async () => expect((await readPlans())[BLOCK_ID]?.[dayOfThisWeek(0)]).not.toBe('A'),
      { timeout: 8000 },
    );

    const plan = (await readPlans())[BLOCK_ID] ?? {};
    const monday = plan[dayOfThisWeek(0)];
    expect(monday).toBeTruthy();
    // The old workout keeps its exercises; it just has no day any more.
    const kept = await db.blockExercise.where('blockId').equals(BLOCK_ID).toArray();
    expect(kept.some((row) => row.daySlot === 'A')).toBe(true);
    expect(Object.values(plan).filter((slot) => slot === 'A')).toEqual([]);
  }, 20000);
});
