import { MUSCLES, MUSCLE_BY_ID } from '../db/seed/muscles';
import type { MuscleId } from '../db/types';
import { BACK_VIEW, FRONT_VIEW, type BodyView } from '../lib/bodyGeometry';

/* -------------------------------------------------------------------------- */
/*  Choosing what a workout trains, by pointing at it.                        */
/*                                                                            */
/*  The same two figures as the Levels heat map and the same traced outlines,  */
/*  but the opposite job: that one is a readout and refuses to be tapped, this */
/*  one is nothing but taps. Kept as a separate component for exactly that     */
/*  reason — a control and a readout that share a body should not share a      */
/*  behaviour, and `Silhouette` says in its own comment that nothing in it is  */
/*  tappable.                                                                  */
/*                                                                            */
/*  It replaced six buttons — upper, lower, push, pull, full, core — which     */
/*  were a guess at which muscles you meant. Pointing at the muscles says it   */
/*  exactly, and the generator now derives the movement patterns from the      */
/*  choice rather than from a category.                                       */
/*                                                                            */
/*  A muscle visible from both sides is one muscle: tapping either figure      */
/*  toggles it and both light up, because "traps" is not two things.          */
/* -------------------------------------------------------------------------- */

const GAP = 10;
const CAPTION = 12;

/* Selected muscles at full `--color-volume` were the deepest red the app has,
   which is the heat map's "you have hammered this" end of the ramp — a picker
   is not a warning. Tinted back over the unselected fill it still reads as
   plainly on, and the full-strength outline keeps the edge crisp. */
const SELECTED_FILL = 'color-mix(in oklab, var(--color-volume) 45%, var(--color-surface-2))';

function View({
  view,
  side,
  selected,
  onToggle,
  x,
}: {
  view: BodyView;
  side: 'front' | 'back';
  selected: Set<MuscleId>;
  onToggle: (muscle: MuscleId) => void;
  x: number;
}) {
  const muscles = Object.keys(view.muscles) as MuscleId[];
  return (
    <g transform={`translate(${x} 0)`}>
      <path
        d={view.body.join(' ')}
        fill="color-mix(in oklab, var(--color-surface-2) 55%, var(--color-surface))"
        stroke="var(--color-border)"
        strokeWidth="0.5"
      />

      {muscles.map((muscleId) => {
        const on = selected.has(muscleId);
        const name = MUSCLE_BY_ID[muscleId]?.name ?? muscleId;
        return (
          <path
            key={muscleId}
            d={(view.muscles[muscleId] ?? []).join(' ')}
            role="button"
            tabIndex={0}
            aria-pressed={on}
            aria-label={name}
            onClick={() => onToggle(muscleId)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onToggle(muscleId);
              }
            }}
            fill={on ? SELECTED_FILL : 'var(--color-surface-2)'}
            stroke={on ? 'var(--color-volume)' : 'var(--color-surface)'}
            strokeWidth={on ? 1 : 0.5}
            className="cursor-pointer outline-none"
          >
            <title>{`${name}${on ? ' — training' : ''}`}</title>
          </path>
        );
      })}

      <text
        x={view.width / 2}
        y={view.height + CAPTION - 3}
        textAnchor="middle"
        fontSize="7"
        fill="var(--color-text-dim)"
      >
        {side}
      </text>
    </g>
  );
}

export function MusclePicker({
  selected,
  onChange,
}: {
  selected: MuscleId[];
  onChange: (next: MuscleId[]) => void;
}) {
  const chosen = new Set(selected);
  const toggle = (muscle: MuscleId) => {
    const next = new Set(chosen);
    if (next.has(muscle)) next.delete(muscle);
    else next.add(muscle);
    // Kept in the seed's order rather than tap order, so the same choice always
    // reads the same way in the summary underneath.
    onChange(MUSCLES.filter((row) => next.has(row.id)).map((row) => row.id));
  };

  const width = FRONT_VIEW.width + GAP + BACK_VIEW.width;
  const height = Math.max(FRONT_VIEW.height, BACK_VIEW.height) + CAPTION;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full touch-manipulation"
      role="group"
      aria-label="Muscles this workout trains"
    >
      <View view={FRONT_VIEW} side="front" selected={chosen} onToggle={toggle} x={0} />
      <View
        view={BACK_VIEW}
        side="back"
        selected={chosen}
        onToggle={toggle}
        x={FRONT_VIEW.width + GAP}
      />
    </svg>
  );
}
