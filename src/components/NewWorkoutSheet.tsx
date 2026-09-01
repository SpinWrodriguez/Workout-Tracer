import { useState } from 'react';
import {
  WORKOUT_FOCUSES,
  WORKOUT_FOCUS_LABEL,
  type Intensity,
  type WorkoutFocus,
} from '../lib/weekTemplate';
import { Sheet } from './Sheet';
import { Label } from './Layout';

/* -------------------------------------------------------------------------- */
/*  Making a workout.                                                         */
/*                                                                            */
/*  Two questions and nothing else: what does it train, and how hard. No day,  */
/*  no week, no "sessions per week" — a workout is a thing you make, and where */
/*  it goes in the calendar is a decision you have not taken yet.              */
/* -------------------------------------------------------------------------- */

const INTENSITIES: Intensity[] = ['heavy', 'light'];

const INTENSITY_LABEL: Record<Intensity, string> = {
  heavy: 'Heavy',
  light: 'Light',
};

const INTENSITY_HINT: Record<Intensity, string> = {
  heavy: 'Full effort, three sets a movement.',
  light: 'Sub-maximal and shorter — higher reps, nothing that taxes grip or spine.',
};

export function NewWorkoutSheet({
  onCreate,
  onBlank,
  onClose,
}: {
  onCreate: (focus: WorkoutFocus, intensity: Intensity) => void;
  onBlank: () => void;
  onClose: () => void;
}) {
  const [focus, setFocus] = useState<WorkoutFocus>('full');
  const [intensity, setIntensity] = useState<Intensity>('heavy');

  const row = (active: boolean, onClick: () => void, label: string, hint?: string) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-left ${
        active ? 'bg-cta text-bg' : 'bg-surface'
      }`}
    >
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold">{label}</span>
        {hint && (
          <span
            className={`mt-0.5 block text-[12px] leading-snug font-medium ${
              active ? 'text-bg/70' : 'text-text-dim'
            }`}
          >
            {hint}
          </span>
        )}
      </span>
      {active && <span className="text-[15px]">✓</span>}
    </button>
  );

  return (
    <Sheet
      title="New workout"
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onBlank}
            className="h-11 flex-1 rounded-full bg-surface-2 text-[13px] font-medium text-text-dim"
          >
            Start empty
          </button>
          <button
            type="button"
            onClick={() => onCreate(focus, intensity)}
            className="h-11 flex-[2] rounded-full bg-cta font-semibold text-bg"
          >
            Build it
          </button>
        </div>
      }
    >
      <Label className="mt-1 block">Trains</Label>
      <div className="mt-2 flex flex-col gap-1.5">
        {WORKOUT_FOCUSES.map((option) =>
          row(focus === option, () => setFocus(option), WORKOUT_FOCUS_LABEL[option]),
        )}
      </div>

      <Label className="mt-5 block">Effort</Label>
      <div className="mt-2 flex flex-col gap-1.5">
        {INTENSITIES.map((option) =>
          row(
            intensity === option,
            () => setIntensity(option),
            INTENSITY_LABEL[option],
            INTENSITY_HINT[option],
          ),
        )}
      </div>

      <p className="mt-5 text-[12px] leading-snug font-medium text-text-dim">
        It goes in your workouts list. Put it in the week whenever you like — nothing is scheduled
        until you say so, and the golf rule is checked against the day you pick.
      </p>
    </Sheet>
  );
}
