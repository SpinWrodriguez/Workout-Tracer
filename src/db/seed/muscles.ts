import type { Muscle } from '../types';

/**
 * svgPathId is the id of the corresponding path in the Phase 4 body
 * silhouette. Recorded now so the seed does not need revisiting later.
 */
export const MUSCLES: Muscle[] = [
  { id: 'chest', name: 'Chest', region: 'upper', svgPathId: 'sil-chest' },
  { id: 'front_delts', name: 'Front Delts', region: 'upper', svgPathId: 'sil-front-delts' },
  { id: 'side_delts', name: 'Side Delts', region: 'upper', svgPathId: 'sil-side-delts' },
  { id: 'rear_delts', name: 'Rear Delts', region: 'upper', svgPathId: 'sil-rear-delts' },
  { id: 'lats', name: 'Lats', region: 'upper', svgPathId: 'sil-lats' },
  { id: 'upper_back', name: 'Upper Back', region: 'upper', svgPathId: 'sil-upper-back' },
  { id: 'traps', name: 'Traps', region: 'upper', svgPathId: 'sil-traps' },
  { id: 'biceps', name: 'Biceps', region: 'upper', svgPathId: 'sil-biceps' },
  { id: 'triceps', name: 'Triceps', region: 'upper', svgPathId: 'sil-triceps' },
  { id: 'forearms', name: 'Forearms', region: 'upper', svgPathId: 'sil-forearms' },
  { id: 'quads', name: 'Quads', region: 'lower', svgPathId: 'sil-quads' },
  { id: 'hamstrings', name: 'Hamstrings', region: 'lower', svgPathId: 'sil-hamstrings' },
  { id: 'glutes', name: 'Glutes', region: 'lower', svgPathId: 'sil-glutes' },
  { id: 'adductors', name: 'Adductors', region: 'lower', svgPathId: 'sil-adductors' },
  { id: 'calves', name: 'Calves', region: 'lower', svgPathId: 'sil-calves' },
  { id: 'abs', name: 'Abs', region: 'core', svgPathId: 'sil-abs' },
  { id: 'obliques', name: 'Obliques', region: 'core', svgPathId: 'sil-obliques' },
  { id: 'lower_back', name: 'Lower Back', region: 'core', svgPathId: 'sil-lower-back' },
];

export const MUSCLE_BY_ID: Record<string, Muscle> = Object.fromEntries(
  MUSCLES.map((m) => [m.id, m]),
);

export function muscleName(id: string): string {
  return MUSCLE_BY_ID[id]?.name ?? id;
}
