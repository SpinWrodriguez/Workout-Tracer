import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../db/seed/exercises';
import type { SetLog } from '../db/types';
import { briefPayload, buildBrief, undertrained } from './aiBrief';
import { VOLUME_LOW } from './volume';

const byId = new Map(EXERCISES.map((e) => [e.id, e]));

const sets = (exerciseId: string, count: number): SetLog[] =>
  Array.from({ length: count }, (_, i) => ({
    sessionId: 's1',
    exerciseId,
    setNo: i + 1,
    reps: 10,
    weightKg: 50,
    effectiveKg: 50,
  }));

describe('reading the shortfall off the week', () => {
  it('finds nothing trained when nothing was logged', () => {
    const short = undertrained([], byId, 100);
    // Every muscle is at zero, so every muscle is short.
    expect(short.length).toBeGreaterThan(10);
    expect(short.every((row) => row.sets === 0)).toBe(true);
  });

  it('ranks untrained muscles above merely light ones', () => {
    // 20 sets of bench: chest is well over the floor, legs untouched.
    const short = undertrained(sets('bb_bench_press', 20), byId, 100);
    expect(short.map((row) => row.id)).not.toContain('chest');
    expect(short[0]?.sets).toBe(0);
    for (let i = 1; i < short.length; i += 1) {
      expect(short[i]?.sets).toBeGreaterThanOrEqual(short[i - 1]?.sets ?? 0);
    }
  });

  it('leaves out anything at or above the weekly floor', () => {
    const short = undertrained(sets('bb_back_squat', 10), byId, 100);
    for (const row of short) expect(row.sets).toBeLessThan(VOLUME_LOW);
    expect(short.map((row) => row.id)).not.toContain('quads');
  });
});

describe('an empty goal box still asks for something', () => {
  it('turns the shortfall into the goal', () => {
    const brief = buildBrief({
      goal: '',
      undertrained: [
        { id: 'lats', name: 'Lats', sets: 0 },
        { id: 'hamstrings', name: 'Hamstrings', sets: 2 },
      ],
      existing: [],
    });
    expect(brief.derived).toBe(true);
    expect(brief.goal).toContain('Lats');
    expect(brief.goal).toContain('nothing yet this week');
    expect(brief.goal).toContain('Hamstrings (2 sets)');
    expect(brief.summary).toContain('Lats');
  });

  it('says so plainly when the week is already covered', () => {
    const brief = buildBrief({ goal: '   ', undertrained: [], existing: [] });
    expect(brief.derived).toBe(true);
    expect(brief.summary).toMatch(/nothing is short/i);
  });

  it('uses a typed goal as-is and does not second-guess it', () => {
    // "Easy today" is an instruction, not a hint to weigh against volume.
    const brief = buildBrief({
      goal: 'today I feel tired, something easy',
      undertrained: [{ id: 'lats', name: 'Lats', sets: 0 }],
      existing: [],
    });
    expect(brief.derived).toBe(false);
    expect(brief.goal).toBe('today I feel tired, something easy');
    expect(brief.goal).not.toContain('Lats');
  });
});

describe('the payload', () => {
  const base = {
    goal: '',
    undertrained: [{ id: 'lats' as const, name: 'Lats', sets: 0 }],
    existing: [],
  };

  it('carries the shortfall only when the goal was derived from it', () => {
    const derived = briefPayload(buildBrief(base), base);
    expect(derived).toHaveProperty('weeklyShortfall');

    const typed = { ...base, goal: 'heavy pull day' };
    expect(briefPayload(buildBrief(typed), typed)).not.toHaveProperty('weeklyShortfall');
  });

  it('passes standing instructions through when set', () => {
    const input = { ...base, instructions: 'Golf matters more than the gym.' };
    expect(briefPayload(buildBrief(input), input)).toMatchObject({
      standingInstructions: 'Golf matters more than the gym.',
    });
    expect(briefPayload(buildBrief(base), base)).not.toHaveProperty('standingInstructions');
  });

  it('states a day limit as a prohibition, never as its reason', () => {
    const input = { ...base, constraints: { noHighGrip: true } };
    const payload = briefPayload(buildBrief(input), input);
    expect(payload.constraints).toEqual(['Do not use any exercise with gripLoad "high".']);
    const serialised = JSON.stringify(payload);
    // The model must not be able to reason about the calendar at all.
    for (const leak of ['golf', 'round', 'Saturday', 'weekday', 'Thursday', 'buffer', 'days clear']) {
      expect(serialised.toLowerCase(), leak).not.toContain(leak.toLowerCase());
    }
  });

  it('never leaks a date, whatever else is in it', () => {
    const input = {
      ...base,
      instructions: 'Building muscle.',
      constraints: { noHighGrip: true, noHighSpinal: true, intensity: 'light' as const },
      existing: [
        { slot: 'A' as const, name: 'Upper', intensity: 'heavy' as const, exerciseIds: ['bb_bench_press'] },
      ],
    };
    const serialised = JSON.stringify(briefPayload(buildBrief(input), input));
    expect(serialised).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(serialised).not.toMatch(/\b(mon|tue|wed|thu|fri|sat|sun)\b/i);
  });
});
