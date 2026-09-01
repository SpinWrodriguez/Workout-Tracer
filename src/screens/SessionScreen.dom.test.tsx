// @vitest-environment jsdom

/*
 * Logging a set, end to end, through the same taps a thumb makes.
 *
 * Both flows here have broken before and neither was caught by a unit test:
 * the keypad discarded a typed value when the next cell was tapped, and the
 * save button either never appeared or never went away. Nothing below reaches
 * into component state — if it passes, the screen genuinely works.
 */

import { exercises, named, seedBlock, seedSchedule, seedWorkout, user, draw } from '../test/dom';

import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { SessionScreen } from './SessionScreen';

const SQUAT = 'bb_back_squat';

async function openProgrammedDay() {
  await seedBlock();
  await seedSchedule({ A: { weekday: 1, intensity: 'heavy' } });
  await seedWorkout('A', [SQUAT], 3);
  const onExit = vi.fn();
  const view = draw(<SessionScreen daySlot="A" exercises={exercises} onExit={onExit} />);
  // The draft and useLiveQuery both resolve asynchronously. A set row being on
  // screen is the screen saying it has a programmed session to log — and the
  // heading alone would not, since the picker's list shows the name too.
  await screen.findByRole('button', { name: 'Set 1 weight' });
  await screen.findByRole('heading', { name: named(SQUAT) });
  return { onExit, view, ui: user() };
}

/** The done checkbox on one set row. Every row carries the same label. */
function doneBox(setNo: number): HTMLElement {
  const boxes = screen.getAllByRole('button', { name: 'Mark set complete' });
  const box = boxes[setNo - 1];
  if (!box) throw new Error(`no set ${setNo} on screen`);
  return box;
}

/** Taps the keypad the way a lifter does: pick the cell, then type. */
async function typeInto(ui: ReturnType<typeof user>, cell: string, digits: string) {
  await ui.click(await screen.findByRole('button', { name: cell }));
  for (const digit of digits) {
    await ui.click(await screen.findByRole('button', { name: digit }));
  }
}

describe('logging a set', () => {
  beforeEach(async () => {
    await db.setLog.clear();
  });

  it('writes what was typed on the keypad to setLog', async () => {
    const { ui } = await openProgrammedDay();

    await typeInto(ui, 'Set 1 weight', '60');
    // 'Next' rather than 'Done': it is the key under the thumb mid-set, and it
    // is the path that once lost the weight on the way to the reps cell.
    await ui.click(screen.getByRole('button', { name: 'Next' }));
    await typeInto(ui, 'Set 1 reps', '8');
    await ui.click(screen.getByRole('button', { name: 'Hide' }));

    await ui.click(doneBox(1));
    await ui.click(await screen.findByRole('button', { name: /^Save · 1 set$/ }));

    await waitFor(async () => expect(await db.setLog.count()).toBe(1));
    const [row] = await db.setLog.toArray();
    expect(row).toMatchObject({ exerciseId: SQUAT, setNo: 1, weightKg: 60, reps: 8 });
    // Spec §5 rule 2: what was loaded AND what it actually lifts. A barbell is
    // 1.0, so these agree here — the point is that the second one is stored.
    expect(row?.effectiveKg).toBe(60);
  });

  it('keeps a weight typed before the thumb moves to another cell', async () => {
    const { ui } = await openProgrammedDay();

    await typeInto(ui, 'Set 1 weight', '60');
    // No Done, no Next: straight to another cell, which is what happens in a
    // garage and what used to throw the entry away.
    await ui.click(screen.getByRole('button', { name: 'Set 2 weight' }));
    await typeInto(ui, 'Set 1 reps', '8');
    await ui.click(screen.getByRole('button', { name: 'Hide' }));
    await ui.click(doneBox(1));
    await ui.click(await screen.findByRole('button', { name: /^Save · 1 set$/ }));

    await waitFor(async () => expect(await db.setLog.count()).toBe(1));
    const [row] = await db.setLog.toArray();
    expect(row?.weightKg).toBe(60);
  });

  it('numbers the saved sets densely, so a skipped middle set leaves no hole', async () => {
    const { ui } = await openProgrammedDay();

    await typeInto(ui, 'Set 1 reps', '8');
    await ui.click(screen.getByRole('button', { name: 'Hide' }));
    // Set 2 left blank on purpose. Set 3 is the third row on screen but the
    // second thing actually logged.
    await typeInto(ui, 'Set 3 reps', '6');
    await ui.click(screen.getByRole('button', { name: 'Hide' }));

    await ui.click(await screen.findByRole('button', { name: /^Save · 2 sets$/ }));

    await waitFor(async () => expect(await db.setLog.count()).toBe(2));
    const rows = (await db.setLog.toArray()).sort((a, b) => a.setNo - b.setNo);
    expect(rows.map((row) => [row.setNo, row.reps])).toEqual([
      [1, 8],
      [2, 6],
    ]);
  });
});

describe('the save button', () => {
  it('is absent on a session with nothing logged', async () => {
    await openProgrammedDay();
    // Furniture, not a prompt: a button that is always there stops meaning
    // anything.
    expect(screen.queryByRole('button', { name: /^Save · / })).toBeNull();
  });

  it('appears once a set has reps against it', async () => {
    const { ui } = await openProgrammedDay();

    await typeInto(ui, 'Set 1 reps', '8');
    await ui.click(screen.getByRole('button', { name: 'Hide' }));

    expect(await screen.findByRole('button', { name: /^Save · 1 set$/ })).toBeTruthy();
  });

  it('stays away for a weight with no reps, which is not a set that happened', async () => {
    const { ui } = await openProgrammedDay();

    await typeInto(ui, 'Set 1 weight', '60');
    await ui.click(screen.getByRole('button', { name: 'Hide' }));

    expect(screen.queryByRole('button', { name: /^Save · / })).toBeNull();
  });

  it('goes away after saving, because there is nothing left unsaved', async () => {
    const { ui, onExit } = await openProgrammedDay();

    await typeInto(ui, 'Set 1 reps', '8');
    await ui.click(screen.getByRole('button', { name: 'Hide' }));
    await ui.click(await screen.findByRole('button', { name: /^Save · 1 set$/ }));

    await waitFor(() => expect(onExit).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Save · / })).toBeNull());
  });
});
