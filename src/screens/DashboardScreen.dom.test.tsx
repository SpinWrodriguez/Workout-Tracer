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
import { draw, exercises } from '../test/dom';
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
