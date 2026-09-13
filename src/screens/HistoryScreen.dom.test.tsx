// @vitest-environment jsdom

/*
 * The month grid as the index into History. The flat all-time list was the
 * thing that got messy; what these pin is that the list shows ONE month, that
 * the grid's arrows are how the other months are reached, and that a day cell
 * opens the session that lives on it.
 */

import { BLOCK_ID, draw, exercises, user } from '../test/dom';

import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { monthTitle, shiftMonth, todayIso } from '../lib/format';
import { HistoryScreen } from './HistoryScreen';

/** A finished session on a date, named so the list rows can be told apart. */
async function logSession(id: string, date: string, name: string) {
  await db.session.put({
    id,
    blockId: BLOCK_ID,
    daySlot: 'A',
    daySlotName: name,
    date,
    durationMin: 40,
  });
  await db.setLog.put({
    sessionId: id,
    exerciseId: 'bb_back_squat',
    setNo: 1,
    weightKg: 60,
    effectiveKg: 60,
    reps: 8,
  });
}

const lastMonth = shiftMonth(todayIso(), -1);

describe('the month grid over the session log', () => {
  it('shows only the month on screen, and the arrows reach the rest', async () => {
    await logSession('s_now', todayIso(), 'This Month Session');
    await logSession('s_old', lastMonth, 'Last Month Session');
    draw(<HistoryScreen exercises={exercises} onOpen={vi.fn()} />);
    const ui = user();

    // The current month: its own session, not the archive.
    await screen.findByText('This Month Session');
    expect(screen.queryByText('Last Month Session')).toBeNull();
    expect(screen.getByRole('heading', { name: monthTitle(todayIso()) })).toBeTruthy();

    // One month back: the other session, and only it.
    await ui.click(screen.getByRole('button', { name: 'Previous month' }));
    await screen.findByText('Last Month Session');
    expect(screen.queryByText('This Month Session')).toBeNull();

    // The edge of the data: nothing older exists, so back is a dead end.
    expect(screen.getByRole('button', { name: 'Previous month' })).toHaveProperty(
      'disabled',
      true,
    );

    // And Today snaps home.
    await ui.click(screen.getByRole('button', { name: 'Today' }));
    await screen.findByText('This Month Session');
  });

  it('never walks into the future — nothing can be logged there', async () => {
    await logSession('s_now', todayIso(), 'This Month Session');
    draw(<HistoryScreen exercises={exercises} onOpen={vi.fn()} />);
    await screen.findByText('This Month Session');
    expect(screen.getByRole('button', { name: 'Next month' })).toHaveProperty('disabled', true);
  });

  it('opens the session that lives on a tapped day', async () => {
    const onOpen = vi.fn();
    await logSession('s_now', todayIso(), 'This Month Session');
    draw(<HistoryScreen exercises={exercises} onOpen={onOpen} />);
    const ui = user();
    await screen.findByText('This Month Session');

    /* The cell is a button whose label carries the date and the count; a day
       with nothing on it is disabled, so this can only hit the trained one. */
    await ui.click(screen.getByRole('button', { name: new RegExp(`${todayIso()}, 1 session`) }));
    expect(onOpen).toHaveBeenCalledWith('s_now');
  });

  it('marks a round on the grid without making it tappable', async () => {
    await logSession('s_now', todayIso(), 'This Month Session');
    const golfDay = todayIso(); // same day: session fills the cell, golf dots it
    await db.golfDay.put({ date: golfDay, status: 'planned', holes: 18 });
    draw(<HistoryScreen exercises={exercises} onOpen={vi.fn()} />);
    await screen.findByText('This Month Session');

    await waitFor(() => {
      const cell = screen.getByRole('button', {
        name: new RegExp(`${todayIso()}, 1 session, golf`),
      });
      expect(within(cell).queryByText('GOLF')).toBeNull(); // a dot, not a chip
    });
  });
});
