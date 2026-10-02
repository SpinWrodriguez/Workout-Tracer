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
import { monthTitle, shiftIso, shiftMonth, todayIso, weekStart } from '../lib/format';
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
    const label = await screen.findByText('best top set (reps) in range');
    expect(within(label.parentElement as HTMLElement).getByText('8')).toBeTruthy();
  });

  it('charts which band was used, not a 1-RM the rating cannot honestly feed', async () => {
    await db.session.put({
      id: 's_band',
      blockId: BLOCK_ID,
      daySlot: 'A',
      date: todayIso(),
      durationMin: 20,
    });
    await db.setLog.put({
      sessionId: 's_band',
      exerciseId: 'bd_lateral_walk',
      setNo: 1,
      weightKg: 11,
      effectiveKg: 11,
      reps: 20,
    });
    draw(<HistoryScreen exercises={exercises} onOpen={vi.fn()} />);

    // The band's own metric pair: the band used, and the reps done with it.
    await screen.findByText('Top band');
    await screen.findByText('Total reps');
    expect(screen.queryByText('Est. 1-RM')).toBeNull();
    const label = await screen.findByText('best top band in range');
    expect(within(label.parentElement as HTMLElement).getByText('11')).toBeTruthy();
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

describe('progress over weeks', () => {
  /** A dated session with `count` sets of one exercise. */
  async function logSets(id: string, date: string, exerciseId: string, count: number, kgs?: number) {
    await db.session.put({ id, blockId: BLOCK_ID, daySlot: 'A', date, durationMin: 40 });
    await db.setLog.bulkPut(
      Array.from({ length: count }, (_, i) => ({
        sessionId: id,
        exerciseId,
        setNo: i + 1,
        weightKg: kgs,
        effectiveKg: kgs,
        reps: 10,
      })),
    );
  }

  it('opens the most recently trained lift, not the most logged one', async () => {
    /* Twelve sets of calf raises five weeks ago used to own the chart for
       good. A single bench session on Monday is what the lifter is after. */
    await logSets('s_calf', shiftIso(todayIso(), -35), 'sm_calf_raise', 12, 40);
    await logSets('s_bench', todayIso(), 'bb_bench_press', 3, 60);
    draw(<HistoryScreen exercises={exercises} onOpen={vi.fn()} />);

    const bench = await screen.findByRole('button', { name: /Bench press/i });
    expect(bench.getAttribute('aria-expanded')).toBe('true');
    const calf = screen.getByRole('button', { name: /calf raise/i });
    expect(calf.getAttribute('aria-expanded')).toBe('false');
  });

  it('calls a muscle trained more lately rising, and one dropped dropped', async () => {
    // Chest: 2 sets a week four weeks back, 6 a week the last four weeks.
    for (let week = 1; week <= 8; week += 1) {
      const date = shiftIso(weekStart(todayIso()), -7 * week + 1);
      await logSets(`s_chest_${week}`, date, 'bb_bench_press', week <= 4 ? 6 : 2, 60);
    }
    // Calves trained only in the older four weeks.
    await logSets('s_calf_old', shiftIso(weekStart(todayIso()), -7 * 6 + 2), 'sm_calf_raise', 4, 40);
    draw(<HistoryScreen exercises={exercises} onOpen={vi.fn()} />);

    const chest = await screen.findByRole('button', { name: /^Chest/ });
    expect(within(chest).getByText('Rising')).toBeTruthy();
    const calves = screen.getByRole('button', { name: /^Calves/ });
    expect(within(calves).getByText('Dropped')).toBeTruthy();
  });
});
