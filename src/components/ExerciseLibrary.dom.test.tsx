// @vitest-environment jsdom

import { BLOCK_ID, draw, seedSchedule, seedWorkout, user } from '../test/dom';

import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { setExerciseDeleted, setExerciseRetired } from '../db/settings';
import { todayIso } from '../lib/format';
import { ExerciseLibrary } from './ExerciseLibrary';

/** The row for one exercise, found by its name. */
const rowOf = async (name: string) =>
  (await screen.findByText(name)).closest('button') as HTMLElement;

describe('the exercise list in Settings', () => {
  it('tags what each exercise is doing, never-used in its own colour', async () => {
    await db.session.put({ id: 's1', blockId: BLOCK_ID, daySlot: 'A', date: todayIso() });
    await db.setLog.bulkPut([
      { sessionId: 's1', exerciseId: 'bb_back_squat', setNo: 1, weightKg: 80, effectiveKg: 80, reps: 5 },
      { sessionId: 's1', exerciseId: 'bb_back_squat', setNo: 2, weightKg: 80, effectiveKg: 80, reps: 5 },
    ]);
    await seedSchedule({ A: { intensity: 'heavy', name: 'Leg day' } });
    await seedWorkout('A', ['bb_back_squat']);
    await setExerciseRetired('sm_squat', true);
    draw(<ExerciseLibrary onClose={vi.fn()} />);

    const squat = await rowOf('Back squat');
    await within(squat).findByText('In 1 workout');
    expect(within(squat).getByText(/2 sets logged/)).toBeTruthy();
    expect(within(squat).queryByText('Never used')).toBeNull();

    const smith = await rowOf('Smith squat');
    expect(within(smith).getByText('Never used')).toBeTruthy();
    expect(within(smith).getByText('Retired')).toBeTruthy();
  });

  it('filters to the never-used, and keeps deleted ones behind their own filter', async () => {
    await db.session.put({ id: 's1', blockId: BLOCK_ID, daySlot: 'A', date: todayIso() });
    await db.setLog.put({
      sessionId: 's1', exerciseId: 'bb_back_squat', setNo: 1, weightKg: 80, effectiveKg: 80, reps: 5,
    });
    await setExerciseDeleted('bb_deadlift', true);
    draw(<ExerciseLibrary onClose={vi.fn()} />);
    const ui = user();

    await screen.findByText('Back squat');
    expect(screen.queryByText('Conventional deadlift')).toBeNull();

    await ui.click(screen.getByRole('button', { name: /^Never used/ }));
    await waitFor(() => expect(screen.queryByText('Back squat')).toBeNull());
    expect(screen.getByText('Bench press')).toBeTruthy();

    await ui.click(screen.getByRole('button', { name: /^Deleted 1/ }));
    const deadlift = await rowOf('Conventional deadlift');
    expect(within(deadlift).getByText('Deleted')).toBeTruthy();
  });

  it('opens the exercise sheet, where it can be retired', async () => {
    draw(<ExerciseLibrary onClose={vi.fn()} />);
    const ui = user();
    await ui.click(await rowOf('Smith squat'));
    await ui.click(await screen.findByRole('button', { name: 'Retire this exercise' }));
    await screen.findByRole('button', { name: 'Bring it back' });
    // The sheet's own Close is the last one: it sits above the list.
    await ui.click(screen.getAllByRole('button', { name: 'Close' }).at(-1) as HTMLElement);
    await waitFor(async () => {
      const row = await rowOf('Smith squat');
      expect(within(row).getByText('Retired')).toBeTruthy();
    });
  });
});
