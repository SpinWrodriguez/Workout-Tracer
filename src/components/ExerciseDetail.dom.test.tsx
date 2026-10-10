// @vitest-environment jsdom

import { confirmWith, draw, exercisesById, seedSchedule, seedWorkout, user } from '../test/dom';

import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Exercise } from '../db/types';
import { db } from '../db/db';
import { readDeletedExercises, readRetiredExercises } from '../db/settings';
import { ExerciseDetail } from './ExerciseDetail';

describe('retiring from the exercise sheet', () => {
  it('retires the exercise and brings it back, keeping nothing else', async () => {
    const deadlift = exercisesById.get('bb_deadlift') as Exercise;
    draw(<ExerciseDetail exercise={deadlift} onClose={vi.fn()} />);
    const ui = user();

    await ui.click(await screen.findByRole('button', { name: 'Retire this exercise' }));
    await waitFor(async () => expect(await readRetiredExercises()).toEqual(['bb_deadlift']));

    await ui.click(await screen.findByRole('button', { name: 'Bring it back' }));
    await waitFor(async () => expect(await readRetiredExercises()).toEqual([]));
  });
});

describe('deleting from the exercise sheet', () => {
  const deadlift = () => exercisesById.get('bb_deadlift') as Exercise;

  it('refuses while a workout holds it, and names the workout', async () => {
    await seedSchedule({ A: { intensity: 'heavy', name: 'Pull day' } });
    await seedWorkout('A', ['bb_deadlift']);
    draw(<ExerciseDetail exercise={deadlift()} onClose={vi.fn()} />);

    const button = await screen.findByRole('button', { name: 'Delete this exercise' });
    await screen.findByText(/In Pull day\. Take it out of that workout first\./);
    expect(button).toHaveProperty('disabled', true);
  });

  it('deletes a logged exercise, says its sets stay, and restores it', async () => {
    await db.setLog.put({
      sessionId: 's1', exerciseId: 'bb_deadlift', setNo: 1, weightKg: 100, effectiveKg: 100, reps: 5,
    });
    confirmWith(true);
    draw(<ExerciseDetail exercise={deadlift()} onClose={vi.fn()} />);
    const ui = user();

    await screen.findByText(/Its 1 logged set stay in History\./);
    await ui.click(screen.getByRole('button', { name: 'Delete this exercise' }));
    await waitFor(async () => expect(await readDeletedExercises()).toEqual(['bb_deadlift']));
    // The row and the set are both still there: History reads them.
    expect(await db.exercise.get('bb_deadlift')).toBeTruthy();
    expect(await db.setLog.where('exerciseId').equals('bb_deadlift').count()).toBe(1);

    await ui.click(await screen.findByRole('button', { name: 'Restore it' }));
    await waitFor(async () => expect(await readDeletedExercises()).toEqual([]));
  });

  it('does nothing when the confirm is cancelled', async () => {
    confirmWith(false);
    draw(<ExerciseDetail exercise={deadlift()} onClose={vi.fn()} />);
    const ui = user();
    await ui.click(await screen.findByRole('button', { name: 'Delete this exercise' }));
    expect(await readDeletedExercises()).toEqual([]);
  });
});
