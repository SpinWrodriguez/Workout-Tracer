import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { budgetMinutes, readTimeFactor } from '../lib/timeModel';
import {
  DEFAULT_TRAINING,
  readTraining,
  writeTraining,
  type TrainingPrefs,
} from '../db/settings';
import { WEEKDAY_LABEL, type Weekday } from '../lib/golf';
import {
  SESSION_SHAPES,
  SESSION_SHAPE_HINT,
  SESSION_SHAPE_LABEL,
} from '../lib/weekTemplate';
import { Card, Chip, Label, SegmentedToggle } from './Layout';

/* -------------------------------------------------------------------------- */
/*  Training preferences: set once, rarely changed.                           */
/*                                                                            */
/*  These used to sit on the block screen, where they were re-answered every   */
/*  time even though the answer never changed. Anything whose answer is always */
/*  the same is a setting, not a choice.                                      */
/* -------------------------------------------------------------------------- */

const WEEKEND: Weekday[] = [6, 7];

const SESSION_LENGTHS = ['30', '40', '60'] as const;
const SESSION_LENGTH_LABEL = { '30': '30 min', '40': '40 min', '60': '60 min' };

export function TrainingPrefsEditor() {
  const [prefs, setPrefs] = useState<TrainingPrefs | null>(null);
  const factor = useLiveQuery(async () => {
    const exercises = await db.exercise.toArray();
    return readTimeFactor(new Map(exercises.map((row) => [row.id, row])));
  }, [], undefined);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void readTraining().then(setPrefs);
  }, []);

  if (!prefs) {
    return (
      <Card title="Training" collapsible>
        <Label>--</Label>
      </Card>
    );
  }

  const patch = (next: Partial<TrainingPrefs>) => {
    setPrefs({ ...prefs, ...next });
    setSaved(false);
  };

  const toggleGolf = (weekday: Weekday) =>
    patch({
      golfWeekdays: prefs.golfWeekdays.includes(weekday)
        ? prefs.golfWeekdays.filter((day) => day !== weekday)
        : [...prefs.golfWeekdays, weekday].sort((a, b) => a - b),
    });

  return (
    <Card
      title="Training"
      collapsible
      summary={`${prefs.weeklySetTarget} sets a week · ${prefs.sessionMinutes} min sessions`}
    >
      <Label>Golf days</Label>
      <p className="mt-1 text-[13px] text-text-dim">
        Grip work stays clear of these, and no session is placed on one.
      </p>
      <div className="mt-2 flex gap-1.5">
        {WEEKEND.map((weekday) => (
          <Chip
            key={weekday}
            active={prefs.golfWeekdays.includes(weekday)}
            onClick={() => toggleGolf(weekday)}
          >
            {WEEKDAY_LABEL[weekday]}
          </Chip>
        ))}
      </div>

      <Label className="mt-4 block">Session length</Label>
      <p className="mt-1 text-[13px] text-text-dim">
        The time budget every generated workout is built to fit.
      </p>
      <div className="mt-1.5">
        <SegmentedToggle
          options={SESSION_LENGTHS}
          value={String(prefs.sessionMinutes) as (typeof SESSION_LENGTHS)[number]}
          onChange={(next) => patch({ sessionMinutes: Number(next) })}
          labels={SESSION_LENGTH_LABEL}
        />
      </div>
      {/* What the app has learned about your pace, said out loud. A budget
          silently scaled by a hidden number is worse than no scaling. */}
      <Label className="mt-2 block">
        {factor === undefined
          ? 'Your sessions are timed against an estimate of 40s a set plus rest. After three logged workouts it starts using your real pace instead.'
          : `Your sessions run at ${Math.round(factor * 100)}% of the estimate, so workouts are built to ${budgetMinutes(prefs.sessionMinutes, factor)} estimate-minutes to land on ${prefs.sessionMinutes}.`}
      </Label>

      <Label className="mt-4 block">Split</Label>
      <div className="mt-1.5">
        <SegmentedToggle
          options={SESSION_SHAPES}
          value={prefs.shape}
          onChange={(next) => patch({ shape: next })}
          labels={SESSION_SHAPE_LABEL}
        />
      </div>
      <Label className="mt-1.5 block">{SESSION_SHAPE_HINT[prefs.shape]}</Label>

      <Label className="mt-4 block">Weekly set target</Label>
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => patch({ weeklySetTarget: Math.max(6, prefs.weeklySetTarget - 3) })}
          aria-label="Fewer sets"
          className="size-9 rounded-xl bg-surface-2 text-lg font-semibold"
        >
          −
        </button>
        <span className="w-12 text-center text-[17px] font-semibold">{prefs.weeklySetTarget}</span>
        <button
          type="button"
          onClick={() => patch({ weeklySetTarget: Math.min(90, prefs.weeklySetTarget + 3) })}
          aria-label="More sets"
          className="size-9 rounded-xl bg-surface-2 text-lg font-semibold"
        >
          +
        </button>
        <span className="ml-1 text-[12px] font-medium text-text-dim">
          sets a week across all muscles
        </span>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => patch(DEFAULT_TRAINING)}
          className="h-11 flex-1 rounded-full bg-surface-2 font-medium text-text-dim"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => {
            void writeTraining(prefs);
            setSaved(true);
          }}
          className="h-11 flex-1 rounded-full bg-cta font-semibold text-bg"
        >
          {saved ? 'Saved' : 'Save training'}
        </button>
      </div>
    </Card>
  );
}
