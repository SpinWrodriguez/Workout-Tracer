// @vitest-environment jsdom

/*
 * The dashboard rings, and one bug worth a whole file.
 *
 * The set target became a Settings control — the number the generator builds
 * weeks to and the validator enforces — and this ring went on printing the
 * constant it was born with. Moving the target to 39 left the dashboard saying
 * 33, so two screens disagreed about the one number the week is judged by, and
 * nothing was wrong with either of them in isolation.
 */

import '../test/dom';

import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WEEKLY_SET_TARGET } from '../lib/blockValidation';
import { readTraining, writeTraining } from '../db/settings';
import { db } from '../db/db';
import { shiftIso, todayIso, weekStart } from '../lib/format';
import { BLOCK_ID, draw, exercises, seedPlan, seedSchedule, seedWorkout } from '../test/dom';
import { DashboardScreen } from './DashboardScreen';

function openDashboard() {
  return draw(
    <DashboardScreen
      exercises={exercises}
      onOpenSession={vi.fn()}
      onStartDay={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
}

/** The denominator the Sets ring is showing, from its own accessible text. */
async function setsTarget(): Promise<number> {
  const ring = await screen.findByText(/of \d+ Sets$/);
  const shown = /of (\d+) Sets/.exec(ring.textContent ?? '');
  return Number(shown?.[1]);
}

describe('the weekly set target', () => {
  it('starts at the default when nothing has been set', async () => {
    openDashboard();
    await waitFor(async () => expect(await setsTarget()).toBe(WEEKLY_SET_TARGET));
  });

  it('is the one from Settings, not the constant', async () => {
    const prefs = await readTraining();
    await writeTraining({ ...prefs, weeklySetTarget: 39 });

    openDashboard();

    await waitFor(async () => expect(await setsTarget()).toBe(39));
  });

  it('follows a change made while the dashboard is on screen', async () => {
    openDashboard();
    await waitFor(async () => expect(await setsTarget()).toBe(WEEKLY_SET_TARGET));

    /* What pressing Save training does. Read live rather than once on mount,
       so the ring behind the Settings screen is right when you come back to
       it — the settings row is the only thing between the two screens. */
    const prefs = await readTraining();
    await writeTraining({ ...prefs, weeklySetTarget: 45 });

    await waitFor(async () => expect(await setsTarget()).toBe(45));
  });
});

/** The value and target a named ring is showing, from its accessible text. */
async function ring(label: string): Promise<{ value: number; target: number }> {
  const node = await screen.findByText(new RegExp(`of \\d+ ${label}$`));
  const shown = new RegExp(`(\\d+) of (\\d+) ${label}`).exec(node.textContent ?? '');
  return { value: Number(shown?.[1]), target: Number(shown?.[2]) };
}

/** A logged session on a date, with one set per exercise. */
async function logSession(id: string, date: string, exerciseIds: string[]) {
  await db.session.put({ id, blockId: BLOCK_ID, daySlot: 'A', date, daySlotName: 'Lower' });
  await db.setLog.bulkPut(
    exerciseIds.map((exerciseId) => ({
      sessionId: id,
      exerciseId,
      setNo: 1,
      weightKg: 60,
      effectiveKg: 60,
      reps: 8,
    })),
  );
}

describe('the muscles ring', () => {
  it('counts every muscle the work touched, not just the primary ones', async () => {
    /* From real data: a week of three sessions had worked 17 muscles and the
       ring said 10, because it counted primaries only — and read as a maxed
       ring, since the invented target was also 10. */
    await logSession('s1', todayIso(), ['bb_bench_press']);

    openDashboard();

    /* Bench press trains chest directly and front delts and triceps
       indirectly. Indirect work is half a set in this app's own volume
       definition, not nothing. */
    await waitFor(async () => expect((await ring('Muscles')).value).toBe(3));
  });

  it('takes its target from the muscles this week plans to touch', async () => {
    await seedSchedule({ A: { intensity: 'heavy', name: 'Lower body' } });
    await seedWorkout('A', ['bb_back_squat']);
    await seedPlan({ [weekStart(todayIso())]: 'A' });

    openDashboard();

    /* Back squat: quads and glutes directly, four more indirectly. Six is
       what the week set out to touch, so six is the denominator. */
    await waitFor(async () => expect((await ring('Muscles')).target).toBe(6));
  });
});

describe('the exercises ring', () => {
  it('takes its target from the exercises this week plans', async () => {
    await seedSchedule({
      A: { intensity: 'heavy', name: 'Lower body' },
      B: { intensity: 'light', name: 'Upper body' },
    });
    await seedWorkout('A', ['bb_back_squat', 'bb_rdl', 'cb_pallof_press']);
    await seedWorkout('B', ['bb_bench_press', 'bw_pull_up']);
    const monday = weekStart(todayIso());
    await seedPlan({ [monday]: 'A', [shiftIso(monday, 2)]: 'B' });

    openDashboard();

    // Five programmed across the two placed days, none of them logged yet.
    await waitFor(async () => expect(await ring('Exercises')).toEqual({ value: 0, target: 5 }));
  });

  it('can go past the target, because the target is the plan and not a cap', async () => {
    await seedSchedule({ A: { intensity: 'heavy', name: 'Lower body' } });
    await seedWorkout('A', ['bb_back_squat']);
    await seedPlan({ [weekStart(todayIso())]: 'A' });
    await logSession('s1', todayIso(), ['bb_back_squat', 'bb_rdl', 'kb_swing']);

    openDashboard();

    /* Three done against one planned. The old constant made this the normal
       state — 18 exercises against a target of 12 — which is what made the
       ring meaningless. */
    await waitFor(async () => expect(await ring('Exercises')).toEqual({ value: 3, target: 1 }));
  });

  it('falls back to a sensible number when the week plans nothing', async () => {
    openDashboard();
    /* An empty week has no plan to measure against, and "0 of 0" is not a
       ring. The Phase 1 constants live on as the fallback and nothing else. */
    await waitFor(async () => expect((await ring('Exercises')).target).toBe(12));
    expect((await ring('Muscles')).target).toBe(10);
  });
});

describe('what counts as this week', () => {
  it('ignores a session dated after this week', async () => {
    /* The date on a session is editable, and the query was open-ended above:
       one session typed with next month's date sat in "This week" until next
       month arrived, against a target that comes from this week's plan. */
    await logSession('now', todayIso(), ['bb_back_squat']);
    await logSession('later', shiftIso(weekStart(todayIso()), 9), ['bb_bench_press', 'bb_curl']);

    openDashboard();

    await waitFor(async () => expect((await ring('Sets')).value).toBe(1));
    expect((await ring('Exercises')).value).toBe(1);
  });

  it('ignores a session from last week', async () => {
    await logSession('old', shiftIso(weekStart(todayIso()), -3), ['bb_back_squat']);
    openDashboard();
    await waitFor(async () => expect((await ring('Sets')).value).toBe(0));
  });
});

describe('mobility work', () => {
  it('is left out of the muscles target, because it is left out of the count', async () => {
    /* setsPerMuscle refuses to count a warm-up as training, so counting it in
       the denominator made a target the numerator could never reach. The
       picker will add one by hand, so this is reachable rather than
       theoretical. */
    await seedSchedule({ A: { intensity: 'heavy', name: 'Lower body' } });
    await seedWorkout('A', ['bb_back_squat', 'mb_90_90']);
    await seedPlan({ [weekStart(todayIso())]: 'A' });

    openDashboard();

    // Back squat's six muscles. The hip switch adds none.
    await waitFor(async () => expect((await ring('Muscles')).target).toBe(6));
    expect((await ring('Exercises')).target).toBe(1);
  });
});
