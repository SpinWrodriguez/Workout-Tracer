import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Block, Exercise } from '../db/types';
import { longDate, todayIso } from '../lib/format';
import {
  GOAL_LABEL,
  endPlan,
  phaseFor,
  planStateOf,
  planWeekOf,
  readUpcomingPlan,
  startPlan,
  MUSCLE_PHASES,
} from '../lib/goalPlans';
import { Card, Label } from './Layout';
import { StartPlanSheet } from './StartPlanSheet';

/* -------------------------------------------------------------------------- */
/*  The plan, at the top of Program.                                          */
/*                                                                            */
/*  Four states. No plan: a way in. Booked: when it starts, and a way to call  */
/*  it off. Running: the week, the phase, this week's target and End plan.     */
/*  Finished: the same banner, saying so. Ending asks first, in the card       */
/*  itself, and says what it keeps.                                           */
/* -------------------------------------------------------------------------- */

const SEGMENT_PHASES = [...new Set(MUSCLE_PHASES.map((p) => p.name))];

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
  const [open, setOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const upcoming = useLiveQuery(() => readUpcomingPlan(), [], undefined);
  const today = todayIso();
  const state = block ? planStateOf(block, today) : undefined;
  const running = state === 'active' || state === 'finished' ? block : undefined;

  if (running?.plan) {
    const week = Math.min(planWeekOf(running, today), running.plan.weeks);
    const phase = phaseFor(week);
    return (
      <Card
        title={`${GOAL_LABEL[running.plan.goal]} · ${
          state === 'finished' ? 'plan finished' : `Week ${week} of ${running.plan.weeks}`
        }`}
        trailing={<Label className="text-volume">{state === 'finished' ? 'Done' : phase.name}</Label>}
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
          {SEGMENT_PHASES.map((name) => (
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
            <Label>This week</Label>
            <p className="text-[14px] font-semibold tabular-nums">
              {phase.mainSets} × {phase.main.low}–{phase.main.high} on the main lifts · {phase.rir}{' '}
              reps in reserve
            </p>
            <p className="mt-0.5 text-[12px] font-medium text-text-dim">
              About {phase.setsPerMuscle} sets per muscle. Golf power stays {phase.powerSets} × 5,
              fast.
            </p>
          </div>
        )}
        {state === 'finished' && (
          <p className="mt-3 text-[13px] font-medium text-text-dim">
            Ended {longDate(running.endDate)}. End the plan to go back to your own workouts, or
            start the next one.
          </p>
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
              Every set you logged stays. Program goes back to your own workouts, New workout and
              the day sheet, as before the plan.
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
    );
  }

  if (upcoming?.plan) {
    return (
      <Card title={`${GOAL_LABEL[upcoming.plan.goal]} plan booked`}>
        <p className="text-[13px] font-medium text-text-dim">
          Starts {longDate(upcoming.startDate)}. Until then your current workouts carry on.
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
      <Card title="Muscle plan · 8 weeks">
        <p className="text-[13px] font-medium text-text-dim">
          Three workouts on Mon, Wed and Fri, the same every week, with targets that climb and a
          lighter last week. Golf power opens each one.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-cta mt-3 w-full rounded-full bg-cta font-semibold text-bg"
        >
          Start a plan
        </button>
      </Card>
      {open && (
        <StartPlanSheet
          exercises={choosable}
          blockEnd={block?.endDate}
          starting={starting}
          onClose={() => setOpen(false)}
          onStart={(start, draft) => {
            setStarting(true);
            void startPlan({ start, draft, exercisesById })
              .then(() => setOpen(false))
              .finally(() => setStarting(false));
          }}
        />
      )}
    </>
  );
}
