import type { MuscleId } from '../db/types';
import { MUSCLE_BY_ID } from '../db/seed/muscles';
import { volumeIntensity, type MuscleVolume } from '../lib/volume';

/* -------------------------------------------------------------------------- */
/*  Body silhouette — spec Phase 4.                                           */
/*                                                                            */
/*  A READOUT, not a picker. Nothing here is tappable; it answers "what did I  */
/*  train this week" at a glance and the list underneath carries the numbers.  */
/*                                                                            */
/*  Bilateral muscles are authored once for the left side and mirrored about   */
/*  the centre line, which halves the path data and makes asymmetry            */
/*  impossible. Each region carries the svgPathId from the Muscle seed, which  */
/*  is what that field was reserved for.                                       */
/* -------------------------------------------------------------------------- */

/** One authored shape. `mirror` draws it again, flipped about x = 50. */
interface Shape {
  d: string;
  mirror?: boolean;
}

const VIEW_W = 100;

/* Head, neck, joints, hands and feet: never shaded, they carry the figure. */
const FRAME: Shape[] = [
  // head
  { d: 'M50 3c5.4 0 9.4 4.6 9.4 10.8S55.4 25 50 25s-9.4-5-9.4-11.2S44.6 3 50 3z' },
  // neck
  { d: 'M45.4 21.6h9.2V30c0 2.4-1.8 3.8-4.6 3.8s-4.6-1.4-4.6-3.8z' },
  // torso: wide at the shoulders, narrowing to the waist
  {
    d: 'M33.6 41C36 36.6 42.4 34 50 34s14 2.6 16.4 7l-1.6 26c-.6 8.2-1.6 16.2-3 24.4H38.2c-1.4-8.2-2.4-16.2-3-24.4z',
  },
  // pelvis
  { d: 'M36.4 89h27.2l-1.6 12c-.8 5.4-4.4 9-11.6 9s-10.8-3.6-11.6-9z' },
  // upper arm and forearm mass, tucked against the torso
  {
    d: 'M28.8 41.6c3.8 0 6.2 3.8 5.8 9.6l-3.6 44c-.4 5-6.2 5-6.6 0l-2.6-43.4c-.4-6.2 3.2-10.2 7-10.2z',
    mirror: true,
  },
  // hand
  {
    d: 'M25 106.4c2.8 0 4.6 2.2 4.2 6l-.8 7c-.4 3.2-1.8 4.6-3.6 4.6s-3.2-1.4-3.6-4.6l-.8-7c-.4-3.8 1.6-6 4.6-6z',
    mirror: true,
  },
  // thigh to ankle
  {
    d: 'M41.4 98c5 0 8 4 7.6 11l-3 79c-.2 4.6-8.4 4.6-8.6 0l-3-79c-.4-7 2-11 7-11z',
    mirror: true,
  },
  // foot
  {
    d: 'M36.8 187h9l1 8.4c.2 2-1 3.4-3 3.4h-5.6c-2 0-3.2-1.4-3-3.4z',
    mirror: true,
  },
];

/** Front view. Anterior groups only. */
const FRONT: Partial<Record<MuscleId, Shape[]>> = {
  traps: [
    {
      d: 'M49 33.8v5c-3.6.4-6.8 1.6-9.4 3.4l-2.8-5.4c3.6-2.4 7.8-3.8 12.2-4z',
      mirror: true,
    },
  ],
  front_delts: [
    {
      d: 'M37 39c-4.8 1.6-8.2 5.2-9 10-.5 3.2.8 5.4 3.2 6 2 .5 3.4-.6 4-3 1-4.4 2.2-9 4.2-13z',
      mirror: true,
    },
  ],
  side_delts: [
    {
      d: 'M28.4 48c-3.8 2.2-6.2 6.8-6 12.2.2 4 2 5.8 4.2 5.4 2-.4 3-2 3-5 0-4.6.2-8.8.8-12.6z',
      mirror: true,
    },
  ],
  chest: [
    {
      d: 'M48.6 41.4v16c-4.8 2.6-9.6 1-12.2-3.4-2.4-4-1.6-9.2 2-12.4 3-2.8 6.8-2.8 10.2-.2z',
      mirror: true,
    },
  ],
  abs: [{ d: 'M44.6 59.4c3.4-1.8 7.4-1.8 10.8 0v27c0 4.6-2.6 7-5.4 7s-5.4-2.4-5.4-7z' }],
  obliques: [
    {
      d: 'M37.8 56c2.6 3 4.6 5.2 5 8.2v21.4c-3.8-.6-6.4-4.6-7.4-10.4-1.2-7-1-13.6 2.4-19.2z',
      mirror: true,
    },
  ],
  biceps: [
    {
      d: 'M27.8 56c3.4-.4 5.6 3 5.8 9.4.2 7-1.6 12-4.6 12.4-3 .4-4.6-4-4.6-10.8 0-6.4 1-10.6 3.4-11z',
      mirror: true,
    },
  ],
  forearms: [
    {
      d: 'M25.8 79c3 .4 4.6 4.6 4.6 12.2 0 8.4-1.8 15.2-4.2 15.6-2.6.4-4.2-5.6-4.2-14 0-8 1.2-14.2 3.8-13.8z',
      mirror: true,
    },
  ],
  quads: [
    {
      d: 'M37.8 97.6c4.6-1.4 8.4 1 8.8 6.4l-1 30c-.4 6.4-4 9.4-7.2 8-3-1.6-4.4-6.6-4.6-15.4 0-11 1.2-24 4-29z',
      mirror: true,
    },
  ],
  adductors: [
    { d: 'M45.2 98c3.2-1.6 6.4-1.6 9.6 0l-1 21.6c-.6 5-2.8 7.4-3.8 7.4s-3.2-2.4-3.8-7.4z' },
  ],
  calves: [
    {
      d: 'M38.6 147c4.2-1.2 7.4 2 7.6 8l-.8 20c-.2 6-3.4 9-6.4 7.6-2.8-1.4-3.8-6.4-3.8-14 0-8.6.8-17.8 3.4-21.6z',
      mirror: true,
    },
  ],
};

/** Back view. Posterior groups. */
const BACK: Partial<Record<MuscleId, Shape[]>> = {
  traps: [
    {
      d: 'M50 29.4c5.8 0 11.2 3.6 14 9.6L58 55.8c-2.4-3.4-5-4.8-8-4.8s-5.6 1.4-8 4.8L36 39c2.8-6 8.2-9.6 14-9.6z',
    },
  ],
  rear_delts: [
    {
      d: 'M37 39c-4.8 1.6-8.4 5.4-9.2 10.6-.5 3.2.8 5.4 3.2 6 2 .5 3.4-.8 4-3.4 1-4.6 2-9.4 3-13.2z',
      mirror: true,
    },
  ],
  upper_back: [{ d: 'M40.4 48.6c6.2-2 13-2 19.2 0l1 15.2c-6.6-2.4-14.6-2.4-21.2 0z' }],
  lats: [
    {
      d: 'M36.4 53.4c4.6 2.4 7.2 6.6 7.4 12.2v20.4c-5-1.6-8.4-7-9.8-14.8-1.2-7 .2-13.4 2.4-17.8z',
      mirror: true,
    },
  ],
  lower_back: [{ d: 'M45.2 66c3.2-1.6 6.4-1.6 9.6 0l1 24.4c0 4-2.4 6-5.8 6s-5.8-2-5.8-6z' }],
  triceps: [
    {
      d: 'M27.8 55.6c3.6-.4 5.8 3.2 6 9.8.2 7.2-1.6 12.4-4.8 12.8-3 .4-4.6-4.2-4.6-11.2 0-6.6 1-11 3.4-11.4z',
      mirror: true,
    },
  ],
  forearms: [
    {
      d: 'M25.8 79c3 .4 4.6 4.6 4.6 12.2 0 8.4-1.8 15.2-4.2 15.6-2.6.4-4.2-5.6-4.2-14 0-8 1.2-14.2 3.8-13.8z',
      mirror: true,
    },
  ],
  glutes: [
    {
      d: 'M38 95c5-1.6 9.2 1 9.8 6.8.6 6.8-2.6 13-7.4 13.8-4.2.8-7-2.6-7.2-8.8 0-5.6 1.8-10.2 4.8-11.8z',
      mirror: true,
    },
  ],
  hamstrings: [
    {
      d: 'M38 116c4.6-1.4 8.2 1.4 8.4 6.8l-.8 20c-.2 6-3.6 9-6.6 7.4-2.8-1.4-3.8-6.6-3.8-15 0-8.4.8-16.2 2.8-19.2z',
      mirror: true,
    },
  ],
  calves: [
    {
      d: 'M38.6 147c4.2-1.2 7.4 2 7.6 8l-.8 20c-.2 6-3.4 9-6.4 7.6-2.8-1.4-3.8-6.4-3.8-14 0-8.6.8-17.8 3.4-21.6z',
      mirror: true,
    },
  ],
};

const MIRROR = `scale(-1 1) translate(${-VIEW_W} 0)`;

/**
 * Untrained reads as --surface-2, full volume as --muscle, mixed in oklab so
 * the ramp stays perceptually even. Done in CSS so it follows the theme.
 */
const SHADE_FLOOR = 20;

function shade(intensity: number): string {
  const clamped = Math.min(1, Math.max(0, intensity));
  if (clamped === 0) return 'var(--color-surface-2)';
  // Trained muscles start at a visible tint rather than fading in from nothing:
  // on a light card the idle grey already sits close to a pale blue.
  const pct = Math.round(SHADE_FLOOR + clamped * (100 - SHADE_FLOOR));
  return `color-mix(in oklab, var(--color-muscle) ${pct}%, var(--color-surface-2))`;
}

function Shapes({
  shapes,
  fill,
  id,
  outline,
}: {
  shapes: Shape[];
  fill: string;
  id?: string;
  outline?: boolean;
}) {
  // A hairline in the page colour separates neighbouring groups without adding
  // a second colour, so the map still reads as one silhouette.
  const stroke = outline ? 'var(--color-surface)' : undefined;
  return (
    <>
      {shapes.map((shape, i) => (
        <g key={i}>
          <path
            d={shape.d}
            fill={fill}
            id={i === 0 ? id : undefined}
            stroke={stroke}
            strokeWidth={outline ? 0.6 : undefined}
          />
          {shape.mirror && (
            <path
              d={shape.d}
              fill={fill}
              transform={MIRROR}
              stroke={stroke}
              strokeWidth={outline ? 0.6 : undefined}
            />
          )}
        </g>
      ))}
    </>
  );
}

function View({
  map,
  volume,
  side,
}: {
  map: Partial<Record<MuscleId, Shape[]>>;
  volume: MuscleVolume;
  side: 'front' | 'back';
}) {
  return (
    <g>
      <Shapes shapes={FRAME} fill="var(--color-surface-2)" />
      {(Object.keys(map) as MuscleId[]).map((muscleId) => (
        <Shapes
          key={`${side}-${muscleId}`}
          shapes={map[muscleId] ?? []}
          fill={shade(volumeIntensity(volume[muscleId] ?? 0))}
          // The seed's svgPathId lands on the first shape of the front view.
          id={side === 'front' ? MUSCLE_BY_ID[muscleId]?.svgPathId : undefined}
          outline
        />
      ))}
    </g>
  );
}

export function Silhouette({ volume }: { volume: MuscleVolume }) {
  return (
    <svg
      viewBox="0 0 210 208"
      className="w-full"
      role="img"
      aria-label="Body map shaded by weekly set volume per muscle"
    >
      <View map={FRONT} volume={volume} side="front" />
      <g transform="translate(110 0)">
        <View map={BACK} volume={volume} side="back" />
      </g>
      <text x="50" y="207" textAnchor="middle" fontSize="7.5" fill="var(--color-text-dim)">
        front
      </text>
      <text x="160" y="207" textAnchor="middle" fontSize="7.5" fill="var(--color-text-dim)">
        back
      </text>
    </svg>
  );
}
