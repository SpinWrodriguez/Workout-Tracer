import { useMemo, useState } from 'react';
import type { Exercise, GoalId } from '../db/types';
import { longDate, shiftIso, todayIso } from '../lib/format';
import { WEEKDAY_LABEL } from '../lib/golf';
import { prescription } from '../lib/repUnit';
import {
  GOALS,
  buildPlanDraft,
  defaultPlanStart,
  phaseFor,
  presetOf,
  prescriptionFor,
  slotOptions,
  type DraftWorkout,
} from '../lib/goalPlans';
import { Label } from './Layout';
import { Sheet } from './Sheet';

/* -------------------------------------------------------------------------- */
/*  Start a plan: choose, review, start.                                      */
/*                                                                            */
/*  Build my workouts fills every slot from the lifter's own shelf (retired    */
/*  and deleted exercises never reach this sheet). The review is where the     */
/*  choice is made: any slot can be swapped, and the list offered only holds   */
/*  exercises that fit that slot — and that are safe the day before golf on    */
/*  the Friday workout. Once started, the three workouts stay put.            */
/* -------------------------------------------------------------------------- */

/** The next four Mondays a plan could start on. */
function startChoices(today: string): string[] {
  const first = defaultPlanStart(today);
  return [0, 1, 2, 3].map((i) => shiftIso(first, 7 * i));
}

export function StartPlanSheet({
  exercises,
  blockEnd,
  initialGoal = 'muscle',
  onStart,
  onClose,
  starting = false,
}: {
  /** The shelf: retired and deleted exercises already taken out. */
  exercises: Exercise[];
  /** When the block now running ends, so the plan can follow straight on:
      it is the default start when it is one of the Mondays offered. */
  blockEnd?: string;
  /** The goal selected when the sheet opens, e.g. the one that follows a finished plan. */
  initialGoal?: GoalId;
  onStart: (goal: GoalId, start: string, draft: DraftWorkout[]) => void;
  onClose: () => void;
  starting?: boolean;
}) {
  const byId = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);
  const choices = startChoices(todayIso());
  const [start, setStart] = useState(
    blockEnd && choices.includes(blockEnd) ? blockEnd : (choices[0] as string),
  );
  const [draft, setDraft] = useState<DraftWorkout[] | undefined>(undefined);
  const [swapping, setSwapping] = useState<{ workout: number; slot: number } | undefined>(undefined);
  const [goal, setGoal] = useState<GoalId>(initialGoal);
  const preset = presetOf(goal);
  const WEEKS = preset.phases.length;
  const week1 = phaseFor(1, goal);

  const setPick = (workout: number, slot: number, id: string) =>
    setDraft((prev) =>
      prev?.map((w, wi) =>
        wi === workout ? { ...w, picks: w.picks.map((p, si) => (si === slot ? id : p)) } : w,
      ),
    );

  if (!draft) {
    return (
      <Sheet
        title="New plan"
        onClose={onClose}
        footer={
          <button
            type="button"
            onClick={() => setDraft(buildPlanDraft(exercises, goal))}
            className="h-cta w-full rounded-full bg-cta font-semibold text-bg"
          >
            Build my workouts
          </button>
        }
      >
        <div className="flex flex-col gap-2">
          {GOALS.map((id) => {
            const option = presetOf(id);
            const on = id === goal;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                onClick={() => setGoal(id)}
                className={`rounded-2xl border-2 p-4 text-left ${
                  on ? 'border-text bg-surface' : 'border-transparent bg-surface-2'
                }`}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="card-title">{option.label}</span>
                  <Label>{option.phases.length} weeks</Label>
                </span>
                <span className="mt-1 block text-[13px] font-medium text-text-dim">{option.blurb}</span>
                {on && (
                  <span className="mt-2 block text-[12px] font-medium text-text-dim">
                    {option.judgedOn} Golf power opens every workout.
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-3 rounded-2xl bg-surface p-4">
          <span className="card-title">Days</span>
          <p className="mt-1 text-[13px] font-medium text-text-dim">
            Mon, Wed and Fri. Friday is the day before golf, so that workout is built with no
            heavy grip, back or legs.
          </p>
        </div>

        <div className="mt-3 rounded-2xl bg-surface p-4">
          <span className="card-title">Starts</span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {choices.map((date) => (
              <button
                key={date}
                type="button"
                aria-pressed={start === date}
                onClick={() => setStart(date)}
                className={`rounded-full px-3 py-1.5 text-[13px] font-medium ${
                  start === date ? 'bg-cta text-bg' : 'bg-surface-2 text-text-dim'
                }`}
              >
                {longDate(date)}
                {date === blockEnd ? ' · block ends' : ''}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] font-medium text-text-dim">
            Ends {longDate(shiftIso(start, WEEKS * 7 - 1))}. Until it starts, your current
            workouts carry on as they are.
          </p>
        </div>
      </Sheet>
    );
  }

  const missing = draft.some((w) => w.picks.some((p) => !p));
  const swap = swapping ? draft[swapping.workout] : undefined;
  const swapSlot = swap && swapping ? swap.def.slots[swapping.slot] : undefined;

  return (
    <Sheet
      title="Review"
      onClose={onClose}
      footer={
        <button
          type="button"
          disabled={starting || missing}
          onClick={() => onStart(goal, start, draft)}
          className="h-cta w-full rounded-full bg-cta font-semibold text-bg disabled:bg-surface-2 disabled:text-text-faint"
        >
          {starting ? 'Starting…' : `Start plan · ${longDate(start)}`}
        </button>
      }
    >
      <p className="text-[13px] font-medium text-text-dim">
        These three repeat every week for {WEEKS} weeks. Swap anything now; once started they
        stay put. Week 1 targets shown.
      </p>

      {draft.map((workout, wi) => (
        <section key={workout.def.slot} className="mt-3 rounded-2xl bg-surface p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="card-title">
              {workout.def.slot} · {workout.def.name}
            </h3>
            <Label>
              {WEEKDAY_LABEL[workout.def.weekday]}
              {workout.def.golfSafe ? ' · golf-safe' : ''}
            </Label>
          </div>
          <p className="mt-1 text-[12px] font-medium text-text-dim">
            Warm-up 5 min: 90/90 hip switch, open book, T-spine + high knee.
          </p>
          {workout.def.slots.map((slot, si) => {
            const exercise = workout.picks[si] ? byId.get(workout.picks[si] as string) : undefined;
            const rx = exercise ? prescriptionFor(slot.role, exercise, week1) : undefined;
            return (
              <div key={slot.key}>
                {si === 0 && <Label className="mt-3 block">Golf · 8 min</Label>}
                {si === 2 && <Label className="mt-3 block">{preset.label}</Label>}
                <div className="flex items-center gap-3 border-t border-border py-2 first:border-t-0">
                  <span className="w-[76px] shrink-0 text-[10.5px] font-bold tracking-wide text-text-faint uppercase">
                    {slot.label}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">
                      {exercise?.name ?? 'Nothing on your shelf fits'}
                    </span>
                    {exercise && rx && (
                      <span className="block text-[12px] font-medium text-text-dim tabular-nums">
                        {prescription(exercise, rx.targetSets, rx.repRangeLow, rx.repRangeHigh)}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSwapping({ workout: wi, slot: si })}
                    aria-label={`Swap ${exercise?.name ?? slot.label}`}
                    className="shrink-0 rounded-lg bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-dim"
                  >
                    Swap
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      ))}

      <section className="mt-3 rounded-2xl bg-surface p-4">
        <h3 className="card-title">The {WEEKS} weeks</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[12.5px] tabular-nums">
            <thead>
              <tr className="text-left text-[11px] text-text-dim">
                <th className="pr-2 pb-1 font-semibold">Week</th>
                <th className="pr-2 pb-1 font-semibold">Phase</th>
                <th className="pr-2 pb-1 font-semibold">Sets / muscle</th>
                <th className="pr-2 pb-1 font-semibold">Reps</th>
                <th className="pb-1 font-semibold">In reserve</th>
              </tr>
            </thead>
            <tbody>
              {preset.phases.map((phase) => (
                <tr key={phase.week} className="border-t border-border">
                  <td className="py-1.5 pr-2">{phase.week}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{phase.name}</td>
                  <td className="py-1.5 pr-2">~{phase.setsPerMuscle}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    {phase.main.low}–{phase.main.high}
                  </td>
                  <td className="py-1.5">{phase.rir}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {swap && swapSlot && swapping && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setSwapping(undefined)}>
          <div className="absolute inset-0 bg-scrim" />
          <div
            role="dialog"
            aria-label={`Swap ${swapSlot.label}`}
            className="relative max-h-[80dvh] overflow-y-auto rounded-t-3xl bg-surface px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+16px)]"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="card-title">{swapSlot.label}</h3>
            <p className="mt-0.5 text-[12px] font-medium text-text-dim">
              Only exercises that fit this slot
              {swap.def.golfSafe ? ' and are safe the day before golf' : ''}.
            </p>
            <div className="mt-3 flex flex-col gap-1.5">
              {slotOptions(swapSlot, exercises, swap.def.golfSafe)
                .filter(
                  (e) =>
                    e.id === swap.picks[swapping.slot] ||
                    !swap.picks.some((picked, i) => i !== swapping.slot && picked === e.id),
                )
                .map((e) => {
                  const current = e.id === swap.picks[swapping.slot];
                  return (
                    <button
                      key={e.id}
                      type="button"
                      aria-pressed={current}
                      onClick={() => {
                        setPick(swapping.workout, swapping.slot, e.id);
                        setSwapping(undefined);
                      }}
                      className={`flex items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-left ${
                        current ? 'bg-cta text-bg' : 'bg-surface-2'
                      }`}
                    >
                      <span className="text-[14px] font-medium">{e.name}</span>
                      <span className="text-[12px] font-medium opacity-70">
                        {current ? 'Chosen' : 'Use'}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}
