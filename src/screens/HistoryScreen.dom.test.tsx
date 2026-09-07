// @vitest-environment jsdom

/*
 * History, and the thing a week rolling over used to hide.
 *
 * The dashboard counts THIS week. On a Monday morning that is zero, and the
 * three sessions of the week before read as if they had never happened —
 * nothing on the History screen answered "what have I actually been doing"
 * without scrolling a list of dates and adding it up by eye.
 */

import '../test/dom';

import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { shiftIso, todayIso, weekStart } from '../lib/format';
import { draw, exercises } from '../test/dom';
import { HistoryScreen } from './HistoryScreen';

/** A finished session on a date, with its sets. */
async function logSession(date: string, name: string, sets: number) {
  const id = `s_${date}`;
  await db.session.put({
    id,
    blockId: 'block_1',
    daySlot: 'A',
    daySlotName: name,
    date,
    durationMin: 40,
  });
  await db.setLog.bulkPut(
    Array.from({ length: sets }, (_, i) => ({
      sessionId: id,
      exerciseId: 'bb_back_squat',
      setNo: i + 1,
      reps: 8,
      weightKg: 60,
      effectiveKg: 60,
    })),
  );
}

function openHistory() {
  return draw(<HistoryScreen exercises={exercises} onOpen={vi.fn()} />);
}

/** Last week, whatever day of this one it happens to be. */
const lastWeek = (offset: number) => shiftIso(weekStart(todayIso()), offset - 7);

describe('every workout, all time', () => {
  it('still counts a week that has already rolled over', async () => {
    await logSession(lastWeek(0), 'Lower Body Strength', 17);
    await logSession(lastWeek(1), 'Upper Body Strength', 18);

    openHistory();

    const card = (
      await screen.findByRole('heading', { name: 'Every workout, all time' })
    ).closest('section') as HTMLElement;

    // The totals, which is the answer the dashboard cannot give on a Monday.
    await waitFor(() => expect(card.textContent).toContain('2'));
    expect(card.textContent).toContain('35');
    // And one tile per workout, each saying how often and how recently.
    expect(within(card).getByText('Lower Body Strength')).toBeTruthy();
    expect(within(card).getByText('Upper Body Strength')).toBeTruthy();
    expect(card.textContent).toContain('1 time · 17 sets');
  });

  it('counts the same workout every time it was done', async () => {
    await logSession(lastWeek(0), 'Lower Body Strength', 17);
    await logSession(shiftIso(lastWeek(0), -7), 'Lower Body Strength', 15);

    openHistory();

    const card = (
      await screen.findByRole('heading', { name: 'Every workout, all time' })
    ).closest('section') as HTMLElement;
    await waitFor(() => expect(card.textContent).toContain('2 times · 32 sets'));
    // One row, not two: it is one workout done twice.
    expect(within(card).getAllByText('Lower Body Strength')).toHaveLength(1);
  });

  it('says nothing at all before anything is logged', async () => {
    openHistory();

    await screen.findByRole('heading', { name: 'Nothing logged yet' });
    expect(screen.queryByRole('heading', { name: 'Every workout, all time' })).toBeNull();
  });
});
