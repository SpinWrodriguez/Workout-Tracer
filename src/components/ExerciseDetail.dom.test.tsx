// @vitest-environment jsdom

import { draw, exercisesById, user } from '../test/dom';

import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Exercise } from '../db/types';
import { readRetiredExercises } from '../db/settings';
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
