// @vitest-environment jsdom

/*
 * Asking a model for ONE workout, driven end to end from the New-workout sheet.
 * Stubbed at `fetch` like the week suite, so askModel, the prompt assembly, the
 * schema parse, the rep clamping, validation and the writes are all real code.
 *
 * The bug this exists for: the sheet has a body picker and a goal box, and the
 * ask sent the words alone. Pick abs and chest, type a line, and back came
 * chin-ups — the model had never been told what was pointed at.
 */

import { BLOCK_ID, exercises, exercisesById, user, draw } from '../test/dom';

import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { writeApiKey } from '../lib/askModel';
import { LIGHT_DAY_CUE } from '../lib/weekTemplate';
import { readSchedules } from '../lib/program';
import { ProgramScreen } from './ProgramScreen';

vi.mock('../lib/supabaseSource', () => ({
  isSupabaseConfigured: () => false,
  getSupabase: async () => undefined,
}));

interface LibraryRow {
  id: string;
  primary: string[];
}

/**
 * Stands in for the model, and answers out of the library it was actually
 * handed — which is the point: if the app narrowed the library, a cooperating
 * model cannot pick outside it, and the reply this test asserts on is the kind
 * a real one would send.
 */
function stubModel({ intensity = 'heavy' }: { intensity?: 'heavy' | 'light' } = {}) {
  const seen: {
    library: LibraryRow[];
    constraints: string[];
    goal: string;
    effort?: { suggested: string; note: string };
  }[] = [];

  const fetchStub = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      system: { text: string }[];
      messages: { content: string }[];
    };
    const systemText = body.system.map((part) => part.text).join('');
    const library = JSON.parse(systemText.slice(systemText.indexOf('Library:\n') + 9)) as LibraryRow[];
    const sent = JSON.parse(String(body.messages[0]?.content)) as {
      goal: string;
      constraints?: string[];
      effort?: { suggested: string; note: string };
    };
    seen.push({
      library,
      constraints: sent.constraints ?? [],
      goal: sent.goal,
      effort: sent.effort,
    });

    /* Three rows the validator will accept: no repeated id, at most one heavy
       spinal lift, nothing advanced. */
    const chosen = library
      .map((row) => exercisesById.get(row.id))
      .filter((exercise) => exercise !== undefined)
      .filter((exercise) => exercise.skillLevel !== 'advanced')
      .filter((exercise, index, all) =>
        exercise.spinalLoad !== 'high'
          ? true
          : all.findIndex((other) => other.spinalLoad === 'high') === index,
      )
      .slice(0, 3);

    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              name: 'Chest and Core',
              focus: 'push',
              intensity,
              exercises: chosen.map((exercise) => ({
                exerciseId: exercise.id,
                sets: intensity === 'light' ? 2 : 3,
                repLow: exercise.repMin,
                repHigh: exercise.repMax,
              })),
            }),
          },
        ],
      }),
      text: async () => '',
    } as unknown as Response;
  });

  vi.stubGlobal('fetch', fetchStub);
  return { seen };
}

beforeEach(() => {
  writeApiKey('sk-ant-test');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Taps a muscle on the body picker inside the sheet. */
async function pickMuscle(ui: ReturnType<typeof user>, name: string) {
  const group = screen.getByRole('group', { name: 'Muscles this workout trains' });
  await ui.click(within(group).getAllByRole('button', { name })[0] as HTMLElement);
}

describe('asking a model for one workout', () => {
  it('sends the muscles that were pointed at, and only their exercises', async () => {
    const { seen } = stubModel();
    draw(<ProgramScreen exercises={exercises} onStartDay={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Plan the week' });
    const ui = user();

    await ui.click(screen.getByRole('button', { name: 'New workout' }));
    await pickMuscle(ui, 'Abs');
    await pickMuscle(ui, 'Chest');
    await ui.type(screen.getByRole('textbox'), 'Something short today');
    await ui.click(screen.getByRole('button', { name: 'Build it from that' }));

    await waitFor(
      async () => {
        const rows = await db.blockExercise.where('blockId').equals(BLOCK_ID).toArray();
        expect(rows.length).toBeGreaterThan(0);
      },
      { timeout: 8000 },
    );

    const call = seen[0];
    expect(call).toBeTruthy();
    // Stated as a requirement, in the ids the model can check its picks against.
    expect(call?.constraints.join(' ')).toMatch(/abs/);
    expect(call?.constraints.join(' ')).toMatch(/chest/);
    // And the typed words are still the goal, not replaced by the muscle list.
    expect(call?.goal).toBe('Something short today');

    /* The part a constraint alone could not do: nothing else was on the menu.
       Every row it was shown trains one of the two. */
    const offered = call?.library ?? [];
    expect(offered.length).toBeGreaterThan(0);
    for (const row of offered) {
      expect(row.primary.some((muscle) => muscle === 'abs' || muscle === 'chest')).toBe(true);
    }
    expect(offered.map((row) => row.id)).not.toContain('bw_neutral_pull_up');

    // And what landed came out of that library, so the workout matches the ask.
    const stored = await db.blockExercise.where('blockId').equals(BLOCK_ID).toArray();
    for (const entry of stored) {
      const exercise = exercisesById.get(entry.exerciseId);
      expect(exercise?.primaryMuscles.some((m) => m === 'abs' || m === 'chest')).toBe(true);
    }
  }, 20000);

  it('sends the effort button as a default, not as a constraint', async () => {
    const { seen } = stubModel();
    draw(<ProgramScreen exercises={exercises} onStartDay={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Plan the week' });
    const ui = user();

    await ui.click(screen.getByRole('button', { name: 'New workout' }));
    await ui.type(screen.getByRole('textbox'), 'Anything');
    await ui.click(screen.getByRole('button', { name: 'Build it from that' }));

    await waitFor(
      async () => {
        const rows = await db.blockExercise.where('blockId').equals(BLOCK_ID).toArray();
        expect(rows.length).toBeGreaterThan(0);
      },
      { timeout: 8000 },
    );

    const call = seen[0];
    // Heavy is the sheet's default, so that is what it starts from.
    expect(call?.effort?.suggested).toBe('heavy');
    /* And it is NOT in the prohibitions list, which the prompt calls absolute.
       That is the difference between a default and a verdict. */
    expect(call?.constraints.join(' ')).not.toMatch(/heavy session/i);
  }, 20000);

  it('lets the typed words overrule the effort button', async () => {
    /*
     * The theory this proves. The button set the intensity, the model was told
     * it was absolute, and then the app overwrote whatever came back with the
     * button's value — so "easy session" against a button reading Heavy got a
     * heavy workout, labelled Heavy, and the words never had a say.
     *
     * The stub stands in for a model that read the words and answered light.
     * What has to land is a LIGHT workout: the stored effort, the two-set cap
     * and the logging cue all follow the reply, not the button.
     */
    stubModel({ intensity: 'light' });
    draw(<ProgramScreen exercises={exercises} onStartDay={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Plan the week' });
    const ui = user();

    await ui.click(screen.getByRole('button', { name: 'New workout' }));
    await ui.type(screen.getByRole('textbox'), 'Easy one, shoulder is sore');
    await ui.click(screen.getByRole('button', { name: 'Build it from that' }));

    let stored: Awaited<ReturnType<typeof readSchedules>>[string] | undefined;
    await waitFor(
      async () => {
        stored = (await readSchedules())[BLOCK_ID];
        expect(Object.values(stored ?? {}).some((day) => day?.generated)).toBe(true);
      },
      { timeout: 8000 },
    );

    const made = Object.values(stored ?? {}).find((day) => day?.generated);
    expect(made?.intensity).toBe('light');
    // The cue is derived from the effort, so it proves the whole chain moved.
    expect(made?.effortCue).toBe(LIGHT_DAY_CUE);

    // And the sets match a light day rather than the button's three.
    const rows = await db.blockExercise.where('blockId').equals(BLOCK_ID).toArray();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.targetSets).toBeLessThanOrEqual(2);
  }, 20000);

  it('leaves the library whole when nothing is picked', async () => {
    const { seen } = stubModel();
    draw(<ProgramScreen exercises={exercises} onStartDay={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Plan the week' });
    const ui = user();

    await ui.click(screen.getByRole('button', { name: 'New workout' }));
    await ui.type(screen.getByRole('textbox'), 'Whatever I need most');
    await ui.click(screen.getByRole('button', { name: 'Build it from that' }));

    await waitFor(
      async () => {
        const rows = await db.blockExercise.where('blockId').equals(BLOCK_ID).toArray();
        expect(rows.length).toBeGreaterThan(0);
      },
      { timeout: 8000 },
    );

    const call = seen[0];
    expect(call?.constraints.join(' ')).not.toMatch(/trains these muscles/);
    // Every non-mobility exercise, because nothing narrowed it.
    expect(call?.library.length).toBe(exercises.filter((row) => !row.isMobility).length);
  }, 20000);
});
