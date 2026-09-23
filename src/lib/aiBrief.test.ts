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
    const short = undertrained([], byId, VOLUME_LOW, 100);
    // Every muscle is at zero, so every muscle is short.
    expect(short.length).toBeGreaterThan(10);
    expect(short.every((row) => row.sets === 0)).toBe(true);
  });

  it('ranks untrained muscles above merely light ones', () => {
    // 20 sets of bench: chest is well over the floor, legs untouched.
    const short = undertrained(sets('bb_bench_press', 20), byId, VOLUME_LOW, 100);
    expect(short.map((row) => row.id)).not.toContain('chest');
    expect(short[0]?.sets).toBe(0);
    for (let i = 1; i < short.length; i += 1) {
      expect(short[i]?.sets).toBeGreaterThanOrEqual(short[i - 1]?.sets ?? 0);
    }
  });

  it('measures against the threshold it was given, not the floor', () => {
    /* The screen passes a fair share of the week's target, which is under the
       floor. A muscle between the two is not short of what the week can give
       it, and a list that says it is is a list of everything. */
    const logs = sets('bb_back_squat', 6);
    expect(undertrained(logs, byId, VOLUME_LOW, 100).map((row) => row.id)).toContain('quads');
    expect(undertrained(logs, byId, 5, 100).map((row) => row.id)).not.toContain('quads');
  });

  it('leaves out anything at or above the weekly floor', () => {
    const short = undertrained(sets('bb_back_squat', 10), byId, VOLUME_LOW, 100);
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
    // "Lately", not "this week": the shortfall is a trailing month now.
    expect(brief.goal).toContain('nothing lately');
    expect(brief.goal).toContain('Hamstrings (2 sets a week)');
    expect(brief.summary).toContain('Lats');
  });

  it('averages a trailing month back to weekly sets before judging shortfall', () => {
    /* 12 quad sets over four weeks is 3 a week — short against a share of 5.
       Judged raw it would read as covered, which is how the week generator
       used to end up guessing: its one-week window was usually empty. */
    const logs = sets('bb_back_squat', 12);
    const short = undertrained(logs, byId, 5, 100, 4);
    const quads = short.find((row) => row.id === 'quads');
    expect(quads?.sets).toBe(3);
    // The same logs over one week are 12 sets, which is not short at all.
    expect(undertrained(logs, byId, 5, 100).find((row) => row.id === 'quads')).toBeUndefined();
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

  it('carries the shortfall with a typed goal too — data, not an order', () => {
    /* It used to ride only when the goal was derived, so typing one word into
       the note box blinded the generator to every volume number the app keeps.
       The prompt says the goal outranks it; hiding it was never the contract. */
    const derived = briefPayload(buildBrief(base), base);
    expect(derived).toHaveProperty('weeklyShortfall');

    const typed = { ...base, goal: 'heavy pull day' };
    expect(briefPayload(buildBrief(typed), typed)).toHaveProperty('weeklyShortfall');

    const covered = { ...base, undertrained: [] };
    expect(briefPayload(buildBrief(covered), covered)).not.toHaveProperty('weeklyShortfall');
  });

  it('names the stalled lifts, and says nothing when none are', () => {
    const input = {
      ...base,
      stalled: [{ id: 'bb_bench_press', name: 'Bench press' }],
    };
    expect(briefPayload(buildBrief(input), input)).toMatchObject({
      stalledExercises: [{ id: 'bb_bench_press', name: 'Bench press' }],
    });
    expect(briefPayload(buildBrief(base), base)).not.toHaveProperty('stalledExercises');
  });

  it('passes standing instructions through when set', () => {
    const input = { ...base, instructions: 'Golf matters more than the gym.' };
    expect(briefPayload(buildBrief(input), input)).toMatchObject({
      standingInstructions: 'Golf matters more than the gym.',
    });
    expect(briefPayload(buildBrief(base), base)).not.toHaveProperty('standingInstructions');
  });

  it('sends the chosen effort as a default and not as a constraint', () => {
    /*
     * The distinction is the whole point. `constraints` is documented to the
     * model as absolute, and the button is not: typing "easy, shoulder is
     * sore" with Heavy still selected has to produce a light session. Putting
     * it in the prohibitions list is what made the button win that argument.
     */
    const input = { ...base, constraints: { effortDefault: 'heavy' as const } };
    const payload = briefPayload(buildBrief(input), input);
    expect(payload).not.toHaveProperty('constraints');
    expect(payload.effort).toMatchObject({ suggested: 'heavy' });
    // And it says so in words, because a key named `effort` does not.
    expect(String((payload.effort as { note: string }).note)).toContain('not a requirement');
  });

  it('says what choosing light costs, so the choice is informed', () => {
    /* The light template excludes high grip and high spinal work and the
       validator marks against it. Unsaid, the model picks a deadlift for a
       session it just called light and pays for a retry to be told. */
    const input = { ...base, constraints: { effortDefault: 'light' as const } };
    const note = String(
      (briefPayload(buildBrief(input), input).effort as { note: string }).note,
    );
    expect(note).toContain('gripLoad');
    expect(note).toContain('spinalLoad');
  });

  it('states the muscles that were pointed at, in the ids the model can check', () => {
    /* Names would read better and be uncheckable: `primary` and `secondary` on
       every library row are ids, so a requirement in names is one the model
       cannot hold its own picks against. */
    const input = { ...base, constraints: { muscles: ['abs', 'chest'] } };
    const line = (briefPayload(buildBrief(input), input).constraints as string[]).join(' ');
    expect(line).toContain('abs, chest');
    expect(line).toContain('`primary`');
  });

  it('says nothing about muscles when none were pointed at', () => {
    const input = { ...base, constraints: { muscles: [] } };
    expect(briefPayload(buildBrief(input), input)).not.toHaveProperty('constraints');
  });

  it('never leaks a date or the calendar, whatever else is in it', () => {
    /* Everything set at once, because the leak that matters is the one some
       other field introduces later. The model has already been caught
       reasoning about the calendar; it must not be able to see one. */
    const input = {
      ...base,
      instructions: 'Building muscle.',
      constraints: {
        effortDefault: 'light' as const,
        focus: 'upper' as const,
        muscles: ['lats', 'biceps'],
        maxRpe: 8,
      },
      existing: [
        { slot: 'A' as const, name: 'Upper', intensity: 'heavy' as const, exerciseIds: ['bb_bench_press'] },
      ],
    };
    const serialised = JSON.stringify(briefPayload(buildBrief(input), input));
    expect(serialised).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(serialised).not.toMatch(/\b(mon|tue|wed|thu|fri|sat|sun)\b/i);
    for (const leak of ['golf', 'round', 'weekday', 'buffer', 'days clear']) {
      expect(serialised.toLowerCase(), leak).not.toContain(leak.toLowerCase());
    }
  });
});

describe('the effort ceiling', () => {
  /*
   * 19 of the first 65 logged sets came in at RPE 10, against standing
   * instructions that ask for sustainable progression. A rep range does not
   * say how close to failure to take it, so the ceiling has to be said.
   */
  const base = { undertrained: [], existing: [] };

  it('reaches the model as a constraint, in reps left rather than in RPE', () => {
    const input = { ...base, constraints: { maxRpe: 8 } };
    const line = (briefPayload(buildBrief(input), input).constraints as string[]).join(' ');
    expect(line).toContain('RPE 8');
    expect(line).toContain('2 reps in reserve');
  });

  it('says one rep, not 1 reps', () => {
    const input = { ...base, constraints: { maxRpe: 9 } };
    const line = (briefPayload(buildBrief(input), input).constraints as string[]).join(' ');
    expect(line).toContain('1 rep in reserve');
  });

  it('says nothing at all when the ceiling is failure', () => {
    // A ceiling of 10 is not a ceiling, and stating it would read as a licence.
    const input = { ...base, constraints: { maxRpe: 10 } };
    expect(briefPayload(buildBrief(input), input)).not.toHaveProperty('constraints');
  });
});
