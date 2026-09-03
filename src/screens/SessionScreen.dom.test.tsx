// @vitest-environment jsdom

/*
 * Logging a set, end to end, through the same taps a thumb makes.
 *
 * Both flows here have broken before and neither was caught by a unit test:
 * the keypad discarded a typed value when the next cell was tapped, and the
 * save button either never appeared or never went away. Nothing below reaches
 * into component state — if it passes, the screen genuinely works.
 */

import {
  confirmWith,
  exercises,
  named,
  seedBlock,
  seedSchedule,
  seedWorkout,
  user,
  draw,
} from '../test/dom';

import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { readActiveSession, writeActiveSession } from '../db/settings';
import { todayIso } from '../lib/format';
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

/**
 * The stored draft, once the debounced write has landed. Its own helper so no
 * assertion races the one-second delay — which is a product decision, not a
 * number the tests get to shorten.
 */
async function waitForDraft() {
  let stored: Awaited<ReturnType<typeof readActiveSession>>;
  await waitFor(
    async () => {
      stored = await readActiveSession();
      expect(stored).toBeDefined();
    },
    { timeout: 4000 },
  );
  return stored as NonNullable<typeof stored>;
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

describe('leaving a workout and coming back', () => {
  /*
   * The whole point: stepping out mid-set to look at the Levels screen used to
   * cost you the session, because Close discarded the draft and Save wrote it
   * down as finished. There was no third option and this is it.
   */
  it('keeps the sets when the screen is closed', async () => {
    const { ui, onExit, view } = await openProgrammedDay();

    await typeInto(ui, 'Set 1 weight', '60');
    await typeInto(ui, 'Set 1 reps', '8');
    await ui.click(screen.getByRole('button', { name: 'Hide' }));

    // The write is debounced a second: a Dexie put per keystroke would be a
    // lot of writes for nothing.
    const stored = await waitForDraft();
    expect((stored.draft as { exercises: unknown[] }).exercises).toHaveLength(1);

    // 'Later', not 'Close' — the word changed because the meaning did.
    await ui.click(await screen.findByRole('button', { name: 'Later' }));
    expect(onExit).toHaveBeenCalled();

    // Nothing is in History: leaving is not saving.
    expect(await db.setLog.count()).toBe(0);

    // Coming back finds the workout where it was left.
    view.unmount();
    draw(<SessionScreen daySlot="A" exercises={exercises} onExit={vi.fn()} />);
    const weight = await screen.findByRole('button', { name: 'Set 1 weight' });
    await waitFor(() => expect(weight.textContent).toContain('60'));
    expect(screen.getByRole('button', { name: 'Set 1 reps' }).textContent).toContain('8');
  });

  it('offers Save the moment it is resumed, with nothing edited', async () => {
    /*
     * A resumed workout has never been saved, so it is unsaved by definition.
     * Treating the resumed draft as the saved state hid Save until something
     * was changed: four logged sets on disk and no way to file them.
     */
    const { ui, view } = await openProgrammedDay();
    await typeInto(ui, 'Set 1 reps', '8');
    await ui.click(screen.getByRole('button', { name: 'Hide' }));
    await waitForDraft();

    view.unmount();
    draw(<SessionScreen daySlot="A" exercises={exercises} onExit={vi.fn()} />);

    expect(await screen.findByRole('button', { name: /^Save · 1 set$/ })).toBeTruthy();
  });

  it('records the duration from when the workout began, not from the remount', async () => {
    /*
     * A session left for forty minutes and finished on return is a forty-minute
     * session. Timing it from the mount would file it as one minute, and that
     * number feeds the shared activity row the nutrition app reads.
     */
    await seedBlock();
    await seedSchedule({ A: { weekday: 1, intensity: 'heavy' } });
    await seedWorkout('A', [SQUAT], 3);
    await writeActiveSession({
      draft: {
        id: 's_resumed',
        blockId: 'block_1',
        daySlot: 'A',
        date: todayIso(),
        exercises: [{ exerciseId: SQUAT, sets: [{ setNo: 1, done: false }] }],
      },
      startedAt: Date.now() - 40 * 60_000,
    });

    draw(<SessionScreen daySlot="A" exercises={exercises} onExit={vi.fn()} />);
    await screen.findByRole('button', { name: 'Set 1 weight' });
    const ui = user();

    await typeInto(ui, 'Set 1 reps', '8');
    await ui.click(screen.getByRole('button', { name: 'Hide' }));
    await ui.click(await screen.findByRole('button', { name: /^Save · 1 set$/ }));

    await waitFor(async () => expect(await db.session.get('s_resumed')).toBeDefined());
    const saved = await db.session.get('s_resumed');
    expect(saved?.durationMin).toBeGreaterThanOrEqual(39);
  });

  it('stops being in progress once it is saved', async () => {
    const { ui } = await openProgrammedDay();

    await typeInto(ui, 'Set 1 reps', '8');
    await ui.click(screen.getByRole('button', { name: 'Hide' }));
    await waitForDraft();

    await ui.click(await screen.findByRole('button', { name: /^Save · 1 set$/ }));

    // Otherwise the app would offer to resume a workout already in History.
    await waitFor(async () => expect(await readActiveSession()).toBeUndefined(), {
      timeout: 4000,
    });
  });

  it('throws it away only when discarding, and asks first', async () => {
    const { ui, onExit } = await openProgrammedDay();

    await typeInto(ui, 'Set 1 reps', '8');
    await ui.click(screen.getByRole('button', { name: 'Hide' }));
    await waitForDraft();

    confirmWith(false);
    await ui.click(screen.getByRole('button', { name: 'Discard this workout' }));
    expect(await readActiveSession()).toBeDefined();
    expect(onExit).not.toHaveBeenCalled();

    confirmWith(true);
    await ui.click(screen.getByRole('button', { name: 'Discard this workout' }));
    await waitFor(async () => expect(await readActiveSession()).toBeUndefined(), {
      timeout: 4000,
    });
    expect(onExit).toHaveBeenCalled();
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

describe('taking an exercise back out of a session', () => {
  it('asks first when sets have already been logged against it', async () => {
    const { ui } = await openProgrammedDay();

    await typeInto(ui, 'Set 1 weight', '60');
    await ui.click(screen.getByRole('button', { name: 'Next' }));
    await typeInto(ui, 'Set 1 reps', '8');
    await ui.click(screen.getByRole('button', { name: 'Hide' }));
    await ui.click(doneBox(1));

    /* Said no. Removing here is the only action in the session that can lose
       work you have already done, and until now both routes to it — this
       button and tapping the exercise again in the picker — did it without a
       word. */
    confirmWith(false);
    await ui.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('heading', { name: named(SQUAT) })).toBeTruthy();
  });

  it('takes it out once, when the answer is yes', async () => {
    const { ui } = await openProgrammedDay();

    await typeInto(ui, 'Set 1 weight', '60');
    await ui.click(screen.getByRole('button', { name: 'Hide' }));
    await ui.click(doneBox(1));

    confirmWith(true);
    await ui.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: named(SQUAT) })).toBeNull(),
    );
  });

  it('does not ask about an exercise with nothing logged against it', async () => {
    const { ui } = await openProgrammedDay();

    /* Nothing done yet, so there is nothing to lose and nothing to ask. A
       confirm here would be a dialog for every mis-tap. */
    confirmWith(false);
    await ui.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: named(SQUAT) })).toBeNull(),
    );
  });
});

describe('the rest timer', () => {
  /* The strip button for an exercise. By its text rather than a regex: the
     names carry brackets, which a regex reads as a group. */
  const stripButton = (exerciseId: string) =>
    screen.getByRole('button', {
      name: (accessible: string) => accessible.includes(named(exerciseId)),
    });

  /** A session of one exercise, opened and ready to log. */
  async function openWith(exerciseId: string) {
    await seedBlock();
    await seedSchedule({ A: { weekday: 1, intensity: 'heavy' } });
    await seedWorkout('A', [exerciseId], 3);
    const view = draw(<SessionScreen daySlot="A" exercises={exercises} onExit={vi.fn()} />);
    await screen.findByRole('button', { name: 'Set 1 weight' });
    return { view, ui: user() };
  }

  it('counts the rest the exercise asks for, not a flat two minutes', async () => {
    /* Every exercise carries a restSeconds and the timer ignored all of it,
       so a band walk and a heavy squat both rested for 120. */
    await openWith('bb_back_squat');
    // 180 seconds on the back squat.
    expect(screen.getByText('3:00')).toBeTruthy();
    expect(screen.getByRole('button', { name: '180s' })).toBeTruthy();
  });

  it("offers the exercise's own rest as a chip even when it is not a preset", async () => {
    // 45 seconds on a band lateral walk, which no preset has.
    await openWith('bd_lateral_walk');
    expect(screen.getByText('0:45')).toBeTruthy();
    expect(screen.getByRole('button', { name: '45s' })).toBeTruthy();
  });

  it('lets a tapped duration win for as long as you are on that exercise', async () => {
    const { ui } = await openWith('bb_back_squat');
    await ui.click(screen.getByRole('button', { name: '120s' }));
    await waitFor(() => expect(screen.getByText('2:00')).toBeTruthy());
  });

  it('drops the tapped one on the way to another exercise', async () => {
    /* It was a choice about that lift, not a setting: carrying 60 seconds
       from a curl onto a heavy squat is the bug the flat 120 already was. */
    await seedBlock();
    await seedSchedule({ A: { weekday: 1, intensity: 'heavy' } });
    await seedWorkout('A', ['bb_back_squat', 'cb_bicep_curl'], 3);
    draw(<SessionScreen daySlot="A" exercises={exercises} onExit={vi.fn()} />);
    await screen.findByRole('button', { name: 'Set 1 weight' });
    const ui = user();

    await ui.click(screen.getByRole('button', { name: '90s' }));
    await waitFor(() => expect(screen.getByText('1:30')).toBeTruthy());

    // Over to the curl, whose own rest is 60 seconds.
    await ui.click(stripButton('cb_bicep_curl'));
    await waitFor(() => expect(screen.getByText('1:00')).toBeTruthy());

    // And back: the squat is its own 180 again, not the 90 that was tapped.
    await ui.click(stripButton('bb_back_squat'));
    await waitFor(() => expect(screen.getByText('3:00')).toBeTruthy());
  });
});
