// @vitest-environment jsdom

/*
 * The calendar IS History now — the lifter's own call: no session list, just
 * the month grid with each trained cell carrying its workout's initials, and
 * a tap opening the full session. What these pin: one month at a time, the
 * arrows reaching the rest, the initials naming the cells, and the tap.
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
  it('names each trained cell with its workout initials, one month at a time', async () => {
    await logSession('s_now', todayIso(), 'This Month Session');
    await logSession('s_old', lastMonth, 'Last Month Session');
    draw(<HistoryScreen exercises={exercises} onOpen={vi.fn()} />);
    const ui = user();

    /* The pill language from the week strip: long names become initials. The
       full name appears nowhere — the calendar is the index, the tap is the
       detail. */
    await screen.findByText('TMS');
    expect(screen.queryByText('LMS')).toBeNull();
    expect(screen.queryByText('This Month Session')).toBeNull();
    expect(screen.getByRole('heading', { name: monthTitle(todayIso()) })).toBeTruthy();

    // One month back: the other cell, and only it.
    await ui.click(screen.getByRole('button', { name: 'Previous month' }));
    await screen.findByText('LMS');
    expect(screen.queryByText('TMS')).toBeNull();

    // The edge of the data: nothing older exists, so back is a dead end.
    expect(screen.getByRole('button', { name: 'Previous month' })).toHaveProperty(
      'disabled',
      true,
    );

    // And Today snaps home.
    await ui.click(screen.getByRole('button', { name: 'Today' }));
    await screen.findByText('TMS');
  });

  it('keeps the session list gone — the calendar is the whole record', async () => {
    await logSession('s_now', todayIso(), 'This Month Session');
    draw(<HistoryScreen exercises={exercises} onOpen={vi.fn()} />);
    await screen.findByText('TMS');
    // The old list said this on every row; nothing on the screen should now.
    expect(screen.queryByText(/effective volume/)).toBeNull();
  });

  it('never walks into the future — nothing can be logged there', async () => {
    await logSession('s_now', todayIso(), 'This Month Session');
    draw(<HistoryScreen exercises={exercises} onOpen={vi.fn()} />);
    await screen.findByText('TMS');
    expect(screen.getByRole('button', { name: 'Next month' })).toHaveProperty('disabled', true);
  });

  it('opens the session that lives on a tapped day', async () => {
    const onOpen = vi.fn();
    await logSession('s_now', todayIso(), 'This Month Session');
    draw(<HistoryScreen exercises={exercises} onOpen={onOpen} />);
    const ui = user();
    await screen.findByText('TMS');

    /* The cell is a button whose label carries the date and the count; a day
       with nothing on it is disabled, so this can only hit the trained one. */
    await ui.click(screen.getByRole('button', { name: new RegExp(`${todayIso()}, 1 session`) }));
    expect(onOpen).toHaveBeenCalledWith('s_now');
  });

  it('charts reps for an unloaded exercise instead of a dead kg toggle', async () => {
    /* Pull-ups log no kg at all, so every kg metric is a flat zero — and the
       chart defaults to the MOST-LOGGED exercise, which made this exact empty
       card the first thing on the screen. The record for unloaded work is
       reps: top set and session total. */
    await db.session.put({
      id: 's_pu',
      blockId: BLOCK_ID,
      daySlot: 'A',
      date: todayIso(),
      durationMin: 20,
    });
    await db.setLog.bulkPut([
      { sessionId: 's_pu', exerciseId: 'bw_pull_up', setNo: 1, reps: 8 },
      { sessionId: 's_pu', exerciseId: 'bw_pull_up', setNo: 2, reps: 6 },
    ]);
    draw(<HistoryScreen exercises={exercises} onOpen={vi.fn()} />);

    // The rep toggle replaces the kg one; 1-RM means nothing here.
    await screen.findByText('Total reps');
    expect(screen.queryByText('Est. 1-RM')).toBeNull();
    // Best top set is the 8-rep set, stated in reps, not a kg zero.
    await screen.findByText('best top set (reps) in range');
    expect(screen.getByText('8')).toBeTruthy();
  });

  it('marks a round on the grid without making it tappable', async () => {
    await logSession('s_now', todayIso(), 'This Month Session');
    const golfDay = todayIso(); // same day: session fills the cell, golf dots it
    await db.golfDay.put({ date: golfDay, status: 'planned', holes: 18 });
    draw(<HistoryScreen exercises={exercises} onOpen={vi.fn()} />);
    await screen.findByText('TMS');

    await waitFor(() => {
      const cell = screen.getByRole('button', {
        name: new RegExp(`${todayIso()}, 1 session, golf`),
      });
      expect(within(cell).queryByText('GOLF')).toBeNull(); // a dot, not a chip
    });
  });
});
