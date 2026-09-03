import { MUSCLE_BY_ID } from '../db/seed/muscles';
import type { MuscleId } from '../db/types';
import { BACK_VIEW, FRONT_VIEW, type BodyView } from '../lib/bodyGeometry';
import { HEAT_FULL, VOLUME_HIGH, volumeHeat, type MuscleVolume } from '../lib/volume';

/* -------------------------------------------------------------------------- */
/*  Body heat map — spec Phase 4.                                             */
/*                                                                            */
/*  A READOUT, not a picker. Nothing here is tappable; it answers "what did I  */
/*  train this week" at a glance and the list underneath carries the numbers.  */
/*                                                                            */
/*  One hue, not a rainbow: the quantity is sets, and sets are --color-volume  */
/*  everywhere else in this app — the bars in the list beside this map are the */
/*  same orange. The ramp mixes that hue toward --surface-2, which is what     */
/*  makes it work in both themes without a second palette: "cold" is whatever  */
/*  the card sits on, so the anchor flips with the theme and the steps stay    */
/*  monotonic in lightness either way.                                        */
/*                                                                            */
/*  The ramp tops out at HEAT_FULL, a full week's work for one muscle, rather   */
/*  than at the 8-set floor: saturating at the floor made a muscle on 8 and a  */
/*  muscle on 15 the same colour, and that gap is the one worth seeing.        */
/*                                                                            */
/*  Over the ceiling is a different claim from "more" — it means back off —    */
/*  so it is not another step on the ramp. It gets an outline, and the "Worth  */
/*  a look" card names the muscle, because a status must never be colour       */
/*  alone.                                                                    */
/*                                                                            */
/*  The outlines come from `bodyGeometry.ts`, traced from flat-colour          */
/*  anatomical renders. They replaced eighteen hand-authored blobs that were   */
/*  honest about being blobs: ovals and rectangles on a figure with no anatomy */
/*  in it, which made a heat map of a shape nobody recognised.                 */
/* -------------------------------------------------------------------------- */

/** Space between the two figures, in view units. */
const GAP = 10;
/** Room under the figures for the front/back captions. */
const CAPTION = 12;
/**
 * The tint a muscle starts at the moment it has been trained at all. Without
 * it half a set fades in from nothing, and "trained a little" is exactly the
 * state the map exists to distinguish from "not trained".
 */
const MIN_TINT = 22;

/** Untrained reads as the card's own elevated grey; HEAT_FULL as full volume. */
function heatFill(sets: number): string {
  if (sets <= 0) return 'var(--color-surface-2)';
  const pct = Math.round(MIN_TINT + volumeHeat(sets) * (100 - MIN_TINT));
  return `color-mix(in oklab, var(--color-volume) ${pct}%, var(--color-surface-2))`;
}

/** Sets as the label would say them: 1.5 keeps its half, 3 does not gain one. */
const setsLabel = (sets: number): string =>
  `${Number.isInteger(sets) ? sets : sets.toFixed(1)} ${sets === 1 ? 'set' : 'sets'}`;

function View({
  view,
  volume,
  side,
  x,
}: {
  view: BodyView;
  volume: MuscleVolume;
  side: 'front' | 'back';
  x: number;
}) {
  const muscles = Object.keys(view.muscles) as MuscleId[];
  return (
    <g transform={`translate(${x} 0)`}>
      {/* The figure: head, hands and feet included, never shaded. Its own tone,
          a step off the untrained fill rather than the same one — matched, an
          untrained muscle vanished into the body in dark and the shins read as
          holes in the figure instead of as calves nobody trained. */}
      <path
        d={view.body.join(' ')}
        fill="color-mix(in oklab, var(--color-surface-2) 55%, var(--color-surface))"
        stroke="var(--color-border)"
        strokeWidth="0.5"
      />

      {muscles.map((muscleId) => {
        const sets = volume[muscleId] ?? 0;
        const name = MUSCLE_BY_ID[muscleId]?.name ?? muscleId;
        return (
          <path
            key={muscleId}
            d={(view.muscles[muscleId] ?? []).join(' ')}
            fill={heatFill(sets)}
            /* A hairline in the card colour, so neighbouring groups read as
               separate muscles rather than as one warm mass. */
            stroke={
              sets > VOLUME_HIGH ? 'var(--color-rir-1)' : 'var(--color-surface)'
            }
            strokeWidth={sets > VOLUME_HIGH ? 1 : 0.5}
            /* The seed's svgPathId lands on the front view, which is the one
               that has a shape for most muscles. */
            id={side === 'front' ? MUSCLE_BY_ID[muscleId]?.svgPathId : undefined}
          >
            <title>{`${name} — ${setsLabel(sets)}`}</title>
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

/**
 * Swatches in the legend. The fills themselves are continuous — every value
 * between the minimum tint and full colour is reachable — so this number only
 * decides how finely the key samples that ramp. Eight is what fits the row at
 * a 12px swatch on the narrowest phone this targets.
 */
const LEGEND_STEPS = 8;

/** The ramp sampled evenly, so the colours have a stated meaning. */
function Legend() {
  const steps = Array.from(
    { length: LEGEND_STEPS },
    (_, i) => (HEAT_FULL * i) / (LEGEND_STEPS - 1),
  );
  return (
    <div className="mt-2 flex items-center justify-center gap-2">
      <span className="text-[11px] font-medium text-text-faint">none</span>
      <span className="flex gap-0.5">
        {steps.map((sets) => (
          <span
            key={sets}
            className="size-3 rounded-[3px]"
            style={{ background: heatFill(sets) }}
          />
        ))}
      </span>
      <span className="text-[11px] font-medium text-text-faint">
        {HEAT_FULL}+ sets a week
      </span>
    </div>
  );
}

export function Silhouette({ volume }: { volume: MuscleVolume }) {
  const width = FRONT_VIEW.width + GAP + BACK_VIEW.width;
  const height = Math.max(FRONT_VIEW.height, BACK_VIEW.height) + CAPTION;
  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label="Body map shaded by weekly set volume per muscle"
      >
        <View view={FRONT_VIEW} volume={volume} side="front" x={0} />
        <View
          view={BACK_VIEW}
          volume={volume}
          side="back"
          x={FRONT_VIEW.width + GAP}
        />
      </svg>
      <Legend />
    </div>
  );
}
