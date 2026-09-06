import { useState } from 'react';
import { MUSCLES } from '../db/seed/muscles';
import type { MuscleId } from '../db/types';
import { type Intensity } from '../lib/weekTemplate';
import { MusclePicker } from './MusclePicker';
import { Sheet } from './Sheet';
import { HapticTick } from './HapticTick';
import { Label } from './Layout';

/* -------------------------------------------------------------------------- */
/*  Making a workout.                                                         */
/*                                                                            */
/*  Two questions and nothing else: what does it train, and how hard. No day,  */
/*  no week, no "sessions per week" — a workout is a thing you make, and where */
/*  it goes in the calendar is a decision you have not taken yet.              */
/*                                                                            */
/*  "What does it train" used to be six buttons — upper, lower, push, pull,    */
/*  full, core — each of them a guess at which muscles you meant. Pointing at  */
/*  the muscles says it exactly, and the generator derives the movement        */
/*  patterns from the choice rather than from the category.                   */
/*                                                                            */
/*  Both answers come first because both ways of building read them. The goal  */
/*  box used to sit at the top under "Ask for one", with the picker below      */
/*  under "Or choose yourself" — which said the picker was the other option    */
/*  rather than a shared input, and it was: the ask sent the words alone.     */
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
  onAsk,
  modelAvailable = false,
  asking = false,
  askError,
}: {
  /** The muscles chosen, in the seed's order, and how hard to train them. */
  onCreate: (muscles: MuscleId[], intensity: Intensity) => void;
  onBlank: () => void;
  onClose: () => void;
  /**
   * Describe the session in words and let a model choose the exercises — from
   * the same muscles and effort the manual path uses. Sending only the words
   * was the bug: pick abs and chest, type a line, and the model never heard
   * about the picker.
   */
  onAsk?: (goal: string, muscles: MuscleId[], intensity: Intensity) => void;
  modelAvailable?: boolean;
  asking?: boolean;
  askError?: string;
}) {
  const [muscles, setMuscles] = useState<MuscleId[]>([]);
  const [intensity, setIntensity] = useState<Intensity>('heavy');
  const [goal, setGoal] = useState('');

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
            disabled={muscles.length === 0}
            onClick={() => onCreate(muscles, intensity)}
            className="relative h-11 flex-[2] rounded-full bg-cta font-semibold text-bg disabled:bg-surface-2 disabled:text-text-faint"
          >
            {muscles.length === 0 ? 'Pick a muscle' : 'Build it'}
            <HapticTick />
          </button>
        </div>
      }
    >
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <Label>Trains</Label>
        <span className="flex gap-2">
          <button
            type="button"
            onClick={() => setMuscles(MUSCLES.map((muscle) => muscle.id))}
            className="rounded-full bg-surface px-3 py-1 text-[12px] font-medium text-text-dim"
          >
            Everything
          </button>
          {muscles.length > 0 && (
            <button
              type="button"
              onClick={() => setMuscles([])}
              className="rounded-full bg-surface px-3 py-1 text-[12px] font-medium text-text-dim"
            >
              Clear
            </button>
          )}
        </span>
      </div>

      <MusclePicker selected={muscles} onChange={setMuscles} />

      <Label className="mt-1 block text-center">
        {muscles.length === 0
          ? 'Tap the muscles this workout should train.'
          : muscles.length === MUSCLES.length
            ? 'Everything — a full-body session.'
            : muscles
                .map((id) => MUSCLES.find((muscle) => muscle.id === id)?.name ?? id)
                .join(', ')}
      </Label>

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

      {onAsk && modelAvailable && (
        <>
          <div className="mt-5 h-px bg-border" />
          <Label className="mt-4 block">Or say it in words</Label>
          <textarea
            rows={2}
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            /* A goal, a target and a limit — the three things the app cannot
               work out for itself. "Something easy" was a placeholder about
               mood, which told you nothing about what to type. */
            placeholder="Back and biceps, nothing overhead — left shoulder is sore"
            className="mt-1.5 w-full resize-none rounded-xl bg-surface-2 px-3 py-2.5 text-[15px] placeholder:text-text-faint"
          />
          <button
            type="button"
            disabled={asking || goal.trim().length < 3}
            onClick={() => onAsk(goal, muscles, intensity)}
            className="mt-2 h-11 w-full rounded-full bg-cta font-semibold text-bg disabled:bg-surface-2 disabled:text-text-faint"
          >
            {asking ? 'Thinking…' : 'Build it from that'}
          </button>
          {askError && (
            <p className="mt-2 text-[12px] font-medium" style={{ color: 'var(--color-warn)' }}>
              {askError}
            </p>
          )}
          <Label className="mt-2 block">
            {muscles.length > 0 && muscles.length < MUSCLES.length
              ? 'It works from the muscles and effort above, picks from your exercise list only, and every choice is checked against the rules before it lands. Where it goes in the week is still up to you.'
              : 'It picks from your exercise list only, and every choice is checked against the rules before it lands. Where it goes in the week is still up to you.'}
          </Label>
        </>
      )}


    </Sheet>
  );
}
