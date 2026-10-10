import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Block, Exercise, GoalId } from '../db/types';
import { longDate, todayIso } from '../lib/format';
import {
  GOAL_LABEL,
  endPlan,
  planPhaseOf,
  planStateOf,
  planWeekOf,
  presetOf,
  readUpcomingPlan,
  startPlan,
} from '../lib/goalPlans';
import { readWeekStatus } from '../lib/shortWeek';
import { Card, Label } from './Layout';
import { ShortWeekSheet } from './ShortWeekSheet';
import { StartPlanSheet } from './StartPlanSheet';

/* -------------------------------------------------------------------------- */
/*  The plan, at the top of Program.                                          */
/*                                                                            */
/*  Four states. No plan: a way in. Booked: when it starts, and a way to call  */
/*  it off. Running: the week, the phase, this week's target, the short-week   */
/*  way out and End plan. Finished: what comes next. Ending asks first, in    */
/*  the card itself, and says what it keeps.                                  */
/* -------------------------------------------------------------------------- */

/** What follows a finished plan: build, then make it heavy, then build again. */
const NEXT_GOAL: Record<GoalId, GoalId> = { muscle: 'strength', strength: 'muscle' };

export function PlanCard({
  block,
  choosable,
  exercisesById,
}: {
  /** The current block — a plan once its Monday comes. */
  block: Block | undefined;
  /** The shelf, minus retired and deleted exercises. */
  choosable: Exercise[];
  exercisesById: Map<string, Exercise>;
}) {
  const [starting, setStarting] = useState(false);
  const [open, setOpen] = useState<GoalId | undefined>(undefined);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [shortWeek, setShortWeek] = useState(false);
  const upcoming = useLiveQuery(() => readUpcomingPlan(), [], undefined);
  const today = todayIso();
  const state = block ? planStateOf(block, today) : undefined;
  const running = state === 'active' || state === 'finished' ? block : undefined;
  const status = useLiveQuery(
    async () => (running && state === 'active' ? readWeekStatus(running, today) : undefined),
    [running, state, today],
  );

  const sheet = open && (
    <StartPlanSheet
      exercises={choosable}
      initialGoal={open}
      blockEnd={running ? undefined : block?.endDate}
      starting={starting}
      onClose={() => setOpen(undefined)}
      onStart={(goal, start, draft) => {
        setStarting(true);
        void (async () => {
          // Following on from a finished plan ends it first, keeping its log.
          if (running) await endPlan(running);
          await startPlan({ goal, start, draft, exercisesById });
        })()
          .then(() => setOpen(undefined))
          .finally(() => setStarting(false));
      }}
    />
  );

  if (running?.plan) {
    const preset = presetOf(running.plan.goal);
    const week = planWeekOf(running, today);
    const phase = planPhaseOf(running, today);
    const phaseNames = [...new Set(preset.phases.map((p) => p.name))];
    const reentry = phase.name === 'Re-entry';
    const repeated = (running.plan.offsetWeeks ?? 0) > 0;
    const next = NEXT_GOAL[running.plan.goal];
    return (
      <>
        <Card
          title={`${preset.label} · ${
            state === 'finished' ? 'plan finished' : `Week ${week} of ${running.plan.weeks}`
          }`}
          trailing={
            <Label className="text-volume">{state === 'finished' ? 'Done' : phase.name}</Label>
          }
        >
          <div
            className="grid gap-[3px]"
            style={{ gridTemplateColumns: `repeat(${running.plan.weeks}, 1fr)` }}
            aria-label={`Week ${week} of ${running.plan.weeks}`}
          >
            {Array.from({ length: running.plan.weeks }, (_, i) => (
              <span
                key={i}
                className="h-2 rounded-[3px]"
                style={{
                  background:
                    i + 1 < week || state === 'finished'
                      ? 'var(--color-volume)'
                      : i + 1 === week
                        ? 'color-mix(in srgb, var(--color-volume) 45%, var(--color-surface-2))'
                        : 'var(--color-surface-2)',
                }}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between">
            {phaseNames.map((name) => (
              <span
                key={name}
                className={`text-[10.5px] font-semibold ${
                  name === phase.name && state !== 'finished' ? 'text-text' : 'text-text-faint'
                }`}
              >
                {name}
              </span>
            ))}
          </div>

          {state !== 'finished' && (
            <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5">
              <Label>{reentry ? 'Re-entry week' : 'This week'}</Label>
              <p className="text-[14px] font-semibold tabular-nums">
                {phase.mainSets} × {phase.main.low}–{phase.main.high} on the main lifts ·{' '}
                {phase.rir} reps in reserve
              </p>
              <p className="mt-0.5 text-[12px] font-medium text-text-dim">
                {reentry
                  ? 'Back after time off: week 1 targets, and start about 10% lighter. The plan picks up where you stopped next week.'
                  : `About ${phase.setsPerMuscle} sets per muscle. Golf power stays ${phase.powerSets} × 5, fast.`}
              </p>
              {repeated && !reentry && (
                <p className="mt-0.5 text-[12px] font-medium text-text-dim">
                  Ends {longDate(running.endDate)}, moved out for the weeks repeated.
                </p>
              )}
            </div>
          )}

          {state === 'active' && status && status.behind && status.todo.length > 0 && (
            <p className="mt-3 text-[13px] font-semibold" style={{ color: 'var(--color-warn)' }}>
              Behind this week: {status.done.length} of {status.workouts.length} done.
            </p>
          )}
          {state === 'active' && status && status.todo.length > 0 && (
            <button
              type="button"
              onClick={() => setShortWeek(true)}
              className="mt-3 h-11 w-full rounded-full bg-surface-2 text-sm font-medium text-text-dim"
            >
              Can't make all {status.workouts.length} this week?
            </button>
          )}

          {state === 'finished' && (
            <>
              <p className="mt-3 text-[13px] font-medium text-text-dim">
                Finished {longDate(running.endDate)}. {GOAL_LABEL[next]} next keeps what this plan
                built; your exercises carry over where they fit.
              </p>
              <button
                type="button"
                onClick={() => setOpen(next)}
                className="h-cta mt-3 w-full rounded-full bg-cta font-semibold text-bg"
              >
                Start {GOAL_LABEL[next]} · {presetOf(next).phases.length} weeks
              </button>
            </>
          )}

          {!confirmEnd ? (
            <button
              type="button"
              onClick={() => setConfirmEnd(true)}
              className="mt-3 rounded-lg bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-dim"
            >
              End plan…
            </button>
          ) : (
            <div className="mt-3 rounded-xl bg-surface-2 p-3">
              <p className="text-[14px] font-semibold">
                End the plan{state === 'finished' ? '' : ` at week ${week}`}?
              </p>
              <p className="mt-0.5 text-[12px] font-medium text-text-dim">
                Every set you logged stays. Program goes back to your own workouts, New workout
                and the day sheet, as before the plan.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmEnd(false)}
                  className="rounded-lg bg-surface px-3 py-1.5 text-[12px] font-semibold"
                >
                  Keep the plan
                </button>
                <button
                  type="button"
                  onClick={() => void endPlan(running)}
                  className="rounded-lg px-3 py-1.5 text-[12px] font-semibold"
                  style={{ background: 'var(--color-danger)', color: 'var(--color-danger-text)' }}
                >
                  End plan
                </button>
              </div>
            </div>
          )}
        </Card>
        {shortWeek && (
          <ShortWeekSheet
            block={running}
            exercisesById={exercisesById}
            onClose={() => setShortWeek(false)}
          />
        )}
        {sheet}
      </>
    );
  }

  if (upcoming?.plan) {
    return (
      <Card title={`${GOAL_LABEL[upcoming.plan.goal]} plan booked`}>
        <p className="text-[13px] font-medium text-text-dim">
          Starts {longDate(upcoming.startDate)}. Until then your current workouts carry on; the
          week strip already shows the plan's days.
        </p>
        <button
          type="button"
          onClick={() => void endPlan(upcoming)}
          className="mt-3 rounded-lg bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-dim"
        >
          Cancel the plan
        </button>
      </Card>
    );
  }

  return (
    <>
      <Card title="Plans">
        <p className="text-[13px] font-medium text-text-dim">
          Three workouts on Mon, Wed and Fri, the same every week, with targets that change week by
          week and a lighter last week. Golf power opens each one. Muscle (8 weeks) or Strength (6
          weeks).
        </p>
        <button
          type="button"
          onClick={() => setOpen('muscle')}
          className="h-cta mt-3 w-full rounded-full bg-cta font-semibold text-bg"
        >
          Start a plan
        </button>
      </Card>
      {sheet}
    </>
  );
}
