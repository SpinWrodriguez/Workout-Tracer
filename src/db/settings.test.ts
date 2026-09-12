import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  COACH_MEMORY_KEY,
  DEFAULT_TRAINING,
  MAX_MAX_RPE,
  MAX_MEMORY_NOTES,
  MAX_MEMORY_NOTE_CHARS,
  MIN_MAX_RPE,
  addCoachMemory,
  deleteCoachMemory,
  mergeTraining,
  readCoachMemory,
} from './settings';

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

/*
 * mergeTraining is the only thing standing between a hand-edited settings row
 * and the generation prompt. Every field it reads has a fallback for exactly
 * that reason, and the effort ceiling has a clamp as well: unlike a set target,
 * a nonsense value here does not look wrong on screen.
 */
describe('the effort ceiling', () => {
  it('defaults to one rep in reserve rather than to failure', () => {
    // A default nobody chose should be the sustainable one.
    expect(DEFAULT_TRAINING.maxRpe).toBe(9);
  });

  it('clamps a stored value into the range a ceiling can mean', () => {
    /* A stored 12 would reach the prompt as a ceiling above failure, which is
       no ceiling at all; a stored 2 would ask the generator for a warm-up. */
    expect(mergeTraining({ maxRpe: 12 }).maxRpe).toBe(MAX_MAX_RPE);
    expect(mergeTraining({ maxRpe: 2 }).maxRpe).toBe(MIN_MAX_RPE);
    expect(mergeTraining({ maxRpe: 8 }).maxRpe).toBe(8);
  });

  it('falls back rather than storing nonsense', () => {
    expect(mergeTraining({ maxRpe: 'hard' }).maxRpe).toBe(DEFAULT_TRAINING.maxRpe);
    expect(mergeTraining({}).maxRpe).toBe(DEFAULT_TRAINING.maxRpe);
  });
});

describe('coach memory', () => {
  it('round-trips a note with its date, and deletes by id', async () => {
    const saved = await addCoachMemory('  Back was sore; keep hinges light this week.  ');
    expect(saved.note).toBe('Back was sore; keep hinges light this week.');
    expect(saved.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect((await readCoachMemory()).map((n) => n.id)).toEqual([saved.id]);
    await deleteCoachMemory(saved.id);
    expect(await readCoachMemory()).toEqual([]);
  });

  it('drops the oldest past the cap, never the newest', async () => {
    for (let i = 0; i < MAX_MEMORY_NOTES + 3; i += 1) await addCoachMemory(`note ${i}`);
    const kept = await readCoachMemory();
    expect(kept).toHaveLength(MAX_MEMORY_NOTES);
    expect(kept[0]?.note).toBe('note 3');
    expect(kept.at(-1)?.note).toBe(`note ${MAX_MEMORY_NOTES + 2}`);
  });

  it('caps one note at a distillation, not a transcript', async () => {
    const saved = await addCoachMemory('x'.repeat(MAX_MEMORY_NOTE_CHARS * 3));
    expect(saved.note).toHaveLength(MAX_MEMORY_NOTE_CHARS);
  });

  it('reads a hand-damaged row as fewer notes, never as a crash', async () => {
    await db.settings.put({
      key: COACH_MEMORY_KEY,
      value: [{ note: 'good', id: 'a', savedAt: '2026-09-01T10:00:00Z' }, { id: 'b' }, 42, null],
    });
    const kept = await readCoachMemory();
    expect(kept).toHaveLength(1);
    expect(kept[0]?.note).toBe('good');
  });
});
