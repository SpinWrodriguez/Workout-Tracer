import type { MuscleId } from '../db/types';
import { MUSCLE_BY_ID } from '../db/seed/muscles';
import { volumeIntensity, type MuscleVolume } from '../lib/volume';

/* -------------------------------------------------------------------------- */
/*  Body silhouette — spec Phase 4.                                           */
/*                                                                            */
/*  A READOUT, not a picker. Nothing here is tappable; it answers "what did I  */
/*  train this week" at a glance and the list underneath carries the numbers.  */
/*                                                                            */
/*  Shapes are declared as primitives rather than hand-written béziers so the  */
/*  proportions stay editable. Each region carries the `svgPathId` from the    */
/*  Muscle seed, which is what that field was reserved for.                   */
/* -------------------------------------------------------------------------- */

type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r?: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'path'; d: string };

/** Rendered in both views, never shaded — they anchor the figure. */
const FRAME: Shape[] = [
  { kind: 'ellipse', cx: 50, cy: 20, rx: 12, ry: 15 },
  { kind: 'rect', x: 44, y: 32, w: 12, h: 10, r: 3 },
  { kind: 'rect', x: 41, y: 96, w: 18, h: 10, r: 3 }, // hips
  { kind: 'rect', x: 39, y: 150, w: 10, h: 10, r: 3 }, // knees
  { kind: 'rect', x: 51, y: 150, w: 10, h: 10, r: 3 },
  { kind: 'rect', x: 20, y: 112, w: 9, h: 9, r: 3 }, // hands
  { kind: 'rect', x: 71, y: 112, w: 9, h: 9, r: 3 },
  { kind: 'rect', x: 38, y: 196, w: 11, h: 7, r: 3 }, // feet
  { kind: 'rect', x: 51, y: 196, w: 11, h: 7, r: 3 },
];

/** Front view. Mirrored limbs are two shapes on the same muscle. */
const FRONT: Partial<Record<MuscleId, Shape[]>> = {
  traps: [{ kind: 'path', d: 'M38 42 L50 40 L62 42 L58 50 L42 50 Z' }],
  side_delts: [
    { kind: 'ellipse', cx: 29, cy: 54, rx: 7.5, ry: 10 },
    { kind: 'ellipse', cx: 71, cy: 54, rx: 7.5, ry: 10 },
  ],
  front_delts: [
    { kind: 'ellipse', cx: 37, cy: 51, rx: 7.5, ry: 9 },
    { kind: 'ellipse', cx: 63, cy: 51, rx: 7.5, ry: 9 },
  ],
  chest: [
    { kind: 'rect', x: 33, y: 46, w: 16, h: 20, r: 6 },
    { kind: 'rect', x: 51, y: 46, w: 16, h: 20, r: 6 },
  ],
  abs: [{ kind: 'rect', x: 42, y: 67, w: 16, h: 30, r: 5 }],
  obliques: [
    { kind: 'rect', x: 34, y: 68, w: 7, h: 30, r: 3 },
    { kind: 'rect', x: 59, y: 68, w: 7, h: 30, r: 3 },
  ],
  biceps: [
    { kind: 'ellipse', cx: 28, cy: 74, rx: 6.5, ry: 13 },
    { kind: 'ellipse', cx: 72, cy: 74, rx: 6.5, ry: 13 },
  ],
  forearms: [
    { kind: 'ellipse', cx: 24.5, cy: 98, rx: 5.5, ry: 15 },
    { kind: 'ellipse', cx: 75.5, cy: 98, rx: 5.5, ry: 15 },
  ],
  quads: [
    { kind: 'rect', x: 37, y: 107, w: 11, h: 44, r: 5 },
    { kind: 'rect', x: 52, y: 107, w: 11, h: 44, r: 5 },
  ],
  adductors: [{ kind: 'rect', x: 46, y: 107, w: 8, h: 30, r: 4 }],
  calves: [
    { kind: 'rect', x: 38, y: 159, w: 10, h: 38, r: 5 },
    { kind: 'rect', x: 52, y: 159, w: 10, h: 38, r: 5 },
  ],
};

/** Back view. Same frame, posterior muscles. */
const BACK: Partial<Record<MuscleId, Shape[]>> = {
  traps: [{ kind: 'path', d: 'M36 42 L50 40 L64 42 L58 60 L42 60 Z' }],
  rear_delts: [
    { kind: 'ellipse', cx: 29, cy: 53, rx: 7.5, ry: 10 },
    { kind: 'ellipse', cx: 71, cy: 53, rx: 7.5, ry: 10 },
  ],
  upper_back: [{ kind: 'rect', x: 38, y: 52, w: 24, h: 16, r: 4 }],
  lats: [
    { kind: 'path', d: 'M34 60 L44 62 L45 92 L37 88 Z' },
    { kind: 'path', d: 'M66 60 L56 62 L55 92 L63 88 Z' },
  ],
  lower_back: [{ kind: 'rect', x: 43, y: 78, w: 14, h: 20, r: 4 }],
  triceps: [
    { kind: 'ellipse', cx: 28, cy: 74, rx: 6.5, ry: 13 },
    { kind: 'ellipse', cx: 72, cy: 74, rx: 6.5, ry: 13 },
  ],
  forearms: [
    { kind: 'ellipse', cx: 24.5, cy: 98, rx: 5.5, ry: 15 },
    { kind: 'ellipse', cx: 75.5, cy: 98, rx: 5.5, ry: 15 },
  ],
  glutes: [
    { kind: 'rect', x: 38, y: 104, w: 11, h: 20, r: 6 },
    { kind: 'rect', x: 51, y: 104, w: 11, h: 20, r: 6 },
  ],
  hamstrings: [
    { kind: 'rect', x: 37, y: 124, w: 11, h: 27, r: 5 },
    { kind: 'rect', x: 52, y: 124, w: 11, h: 27, r: 5 },
  ],
  calves: [
    { kind: 'rect', x: 38, y: 159, w: 10, h: 38, r: 5 },
    { kind: 'rect', x: 52, y: 159, w: 10, h: 38, r: 5 },
  ],
};

/**
 * Untrained reads as --surface-2 and full volume as --muscle, mixed in oklab so
 * the ramp stays perceptually even. Done in CSS rather than JS arithmetic so it
 * follows the theme: the light palette has a white-ish idle and a darker blue,
 * and neither is knowable from here.
 */
const SHADE_FLOOR = 30;

function shade(intensity: number): string {
  const clamped = Math.min(1, Math.max(0, intensity));
  if (clamped === 0) return 'var(--color-surface-2)';
  // Trained muscles start at a visible tint rather than fading in from nothing.
  // On a light card the idle grey is already close to a pale blue, so a raw 3
  // of 20 sets was indistinguishable from untrained.
  const pct = Math.round(SHADE_FLOOR + clamped * (100 - SHADE_FLOOR));
  return `color-mix(in oklab, var(--color-muscle) ${pct}%, var(--color-surface-2))`;
}

function renderShape(shape: Shape, key: string, fill: string, id?: string) {
  const common = { fill, id };
  if (shape.kind === 'rect') {
    return (
      <rect
        key={key}
        {...common}
        x={shape.x}
        y={shape.y}
        width={shape.w}
        height={shape.h}
        rx={shape.r ?? 4}
      />
    );
  }
  if (shape.kind === 'ellipse') {
    return <ellipse key={key} {...common} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} />;
  }
  return <path key={key} {...common} d={shape.d} />;
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
      {FRAME.map((shape, i) => renderShape(shape, `${side}-frame-${i}`, shade(0)))}
      {(Object.keys(map) as MuscleId[]).map((muscleId) => {
        const fill = shade(volumeIntensity(volume[muscleId] ?? 0));
        return (map[muscleId] ?? []).map((shape, i) =>
          renderShape(
            shape,
            `${side}-${muscleId}-${i}`,
            fill,
            // The seed's svgPathId lands on the first shape of the front view.
            side === 'front' && i === 0 ? MUSCLE_BY_ID[muscleId]?.svgPathId : undefined,
          ),
        );
      })}
    </g>
  );
}

export function Silhouette({ volume }: { volume: MuscleVolume }) {
  return (
    <svg
      viewBox="0 0 210 210"
      className="w-full"
      role="img"
      aria-label="Body map shaded by this week's set volume per muscle"
    >
      <View map={FRONT} volume={volume} side="front" />
      <g transform="translate(110 0)">
        <View map={BACK} volume={volume} side="back" />
      </g>
      <text x="50" y="209" textAnchor="middle" fontSize="8" fill="var(--color-text-dim)">
        front
      </text>
      <text x="160" y="209" textAnchor="middle" fontSize="8" fill="var(--color-text-dim)">
        back
      </text>
    </svg>
  );
}
