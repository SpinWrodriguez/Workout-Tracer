// @vitest-environment jsdom

import { draw, exercises, exercisesById, user } from '../test/dom';

import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { shiftIso, todayIso, weekStart } from '../lib/format';
import { buildPlanDraft, defaultPlanStart, startPlan } from '../lib/goalPlans';
import { readBlockPlan } from '../lib/program';
import { ProgramScreen } from '../screens/ProgramScreen';

const openProgram = async () => {
  draw(<ProgramScreen exercises={exercises} onStartDay={() => {}} />);
  await screen.findByRole('heading', { name: 'What this week trains' });
  return user();
};

describe('starting a plan from Program', () => {
  it('builds the workouts, lets a slot be swapped, and books the plan', async () => {
    const ui = await openProgram();
    await ui.click(await screen.findByRole('button', { name: 'Start a plan' }));
    await ui.click(await screen.findByRole('button', { name: 'Build my workouts' }));

    // Three workouts, golf power first.
    await screen.findByRole('heading', { name: 'A · Lower + Push' });
    expect(screen.getByRole('heading', { name: 'C · Upper + Glutes' })).toBeTruthy();

    // Swap the back squat; the list only holds what fits the slot.
    await ui.click(screen.getByRole('button', { name: 'Swap Back squat' }));
    const dialog = await screen.findByRole('dialog', { name: 'Swap Lower' });
    expect(within(dialog).queryByText('Barbell curl')).toBeNull();
    await ui.click(within(dialog).getByRole('button', { name: /Front squat/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await ui.click(screen.getByRole('button', { name: /^Start plan/ }));

    const start = defaultPlanStart(todayIso());
    await waitFor(async () => {
      const rows = await db.blockExercise.where('blockId').equals(`plan_${start}`).toArray();
      expect(rows.map((row) => row.exerciseId)).toContain('bb_front_squat');
      expect(rows.map((row) => row.exerciseId)).not.toContain('bb_back_squat');
    });
  });
});

describe('a plan that has started', () => {
  async function running() {
    const start = weekStart(todayIso());
    await startPlan({ start, draft: buildPlanDraft(exercises), exercisesById });
    return start;
  }

  it('shows the week and its target, and is the block a session is built from', async () => {
    const start = await running();
    await openProgram();
    await screen.findByRole('heading', { name: 'Muscle · Week 1 of 8' });
    expect(screen.getByText(/3 × 10–12 on the main lifts/)).toBeTruthy();
    // No new loose workouts while the plan runs.
    expect(screen.queryByRole('button', { name: 'New workout' })).toBeNull();
    expect((await readBlockPlan())?.block.id).toBe(`plan_${start}`);
  });

  it('ends only after asking, and gives the free-form block back', async () => {
    await running();
    const ui = await openProgram();
    await ui.click(await screen.findByRole('button', { name: 'End plan…' }));
    await ui.click(screen.getByRole('button', { name: 'Keep the plan' }));
    expect(screen.getByRole('heading', { name: 'Muscle · Week 1 of 8' })).toBeTruthy();

    await ui.click(screen.getByRole('button', { name: 'End plan…' }));
    await ui.click(screen.getByRole('button', { name: 'End plan' }));
    await screen.findByRole('button', { name: 'Start a plan' });
    await screen.findByRole('button', { name: 'New workout' });
    expect((await readBlockPlan())?.block.plan).toBeUndefined();
  });
});

describe('a plan booked for a later Monday', () => {
  it('leaves the current workouts alone until it starts, and can be called off', async () => {
    const start = shiftIso(weekStart(todayIso()), 14);
    await startPlan({ start, draft: buildPlanDraft(exercises), exercisesById });
    const ui = await openProgram();
    await screen.findByRole('heading', { name: 'Muscle plan booked' });
    expect((await readBlockPlan())?.block.plan).toBeUndefined();

    await ui.click(screen.getByRole('button', { name: 'Cancel the plan' }));
    await screen.findByRole('button', { name: 'Start a plan' });
    expect(await db.block.get(`plan_${start}`)).toBeUndefined();
  });
});
