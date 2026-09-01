/* -------------------------------------------------------------------------- */
/*  Data model — spec §5, field-for-field.                                    */
/*                                                                            */
/*  Two modelling rules that matter more than the rest:                       */
/*   1. SetLog.exerciseId references Exercise, never BlockExercise, so        */
/*      progression charts span blocks.                                       */
/*   2. Store both weightKg (what you loaded) and effectiveKg (after the      */
/*      multiplier). Log the first, chart and compare on the second.          */
/* -------------------------------------------------------------------------- */

export type MuscleId =
  | 'chest'
  | 'front_delts'
  | 'side_delts'
  | 'rear_delts'
  | 'lats'
  | 'upper_back'
  | 'traps'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'adductors'
  | 'calves'
  | 'abs'
  | 'obliques'
  | 'lower_back';

export type Station =
  | 'free_bar'
  | 'smith'
  | 'cable'
  | 'kettlebell'
  | 'bodyweight'
  | 'band'
  | 'landmine';

export type LoadMode = 'weight' | 'bodyweight' | 'rpe_only';

/**
 * Movement pattern, stored rather than derived. Weekly coverage is validated
 * against this, so it has to be a fact about the exercise and not the output of
 * a name-matching heuristic.
 */
export type MovementPattern =
  | 'squat'
  | 'hinge'
  | 'push_h'
  | 'push_v'
  | 'pull_h'
  | 'pull_v'
  | 'carry'
  | 'core'
  | 'rotation';

export type SkillLevel = 'beginner' | 'intermediate' | 'advanced';

/** Axial load. Two 'high' lifts in one session is a lower-back stacking bug. */
export type SpinalLoad = 'none' | 'low' | 'high';
export type GripLoad = 'none' | 'low' | 'high';
export type DaySlot = 'A' | 'B' | 'C' | 'X' | 'Y';

// Seeded once, hand-curated from the garage equipment. ~50 rows.
// freeDbId links to yuhonas/free-exercise-db for description + photos (see §9).
export interface Exercise {
  freeDbId?: string; // e.g. 'Barbell_Squat' — hand-mapped at seed time, nullable
  id: string;
  name: string;
  station: Station;
  attachment?: string;
  primaryMuscles: MuscleId[];
  secondaryMuscles: MuscleId[];
  loadMultiplier: number; // 1.0 free/smith; 0.49 single pulley; 0.98 bilateral
  barWeight?: number; // 20 free, 18 smith
  loadMode: LoadMode;
  gripLoad: GripLoad; // <-- drives the golf rule
  isHinge: boolean; // form-risk flag; schedule fresh, never late in a circuit

  /* --- prescription bounds, validated per exercise ----------------------- */
  /** A Turkish get-up is 1-5 reps; a global range applied to it is nonsense. */
  repMin: number;
  repMax: number;
  /** Drives the real time estimate, not a flat per-exercise guess. */
  restSeconds: number;
  skillLevel: SkillLevel;
  pattern: MovementPattern;
  spinalLoad: SpinalLoad;
}

export interface Muscle {
  id: MuscleId;
  name: string; // 'Lats', 'Front Delts', 'Quads', ...
  region: 'upper' | 'lower' | 'core';
  svgPathId: string; // for the silhouette, Phase 4
}

// Mesocycle — exercises stay FIXED inside a block.
export interface Block {
  id: string;
  startDate: string;
  endDate: string; // 6–8 weeks
  focusMuscles: MuscleId[];
  notes?: string;
}

export interface BlockExercise {
  blockId: string;
  exerciseId: string;
  daySlot: DaySlot;
  targetSets: number;
  repRangeLow: number;
  repRangeHigh: number;
  order: number;
  /** Snapped to a rung of loadableWeights() for this exercise; validated. */
  startWeightKg?: number;
}

export interface Session {
  id: string;
  blockId: string;
  daySlot: string;
  date: string;
  durationMin?: number;
  hrAvg?: number;
  hrMax?: number;
  notes?: string;
}

export interface SetLog {
  sessionId: string;
  exerciseId: string; // NOT blockExerciseId — this is what makes cross-block history work
  setNo: number;
  weightKg?: number; // as loaded, before multiplier
  effectiveKg?: number; // computed: weightKg × loadMultiplier
  reps: number;
  rpe?: number; // 6–10
  rir?: number; // reps in reserve, alternative to RPE
}

export interface BodyWeight {
  date: string;
  kg: number;
}

/* --- Shared tables owned jointly with the nutrition app (spec §10) -------- */

export interface Activity {
  date: string;
  name: string;
  kcal: number;
  source: 'workout' | 'manual' | 'golf';
}

export interface Goals {
  date: string;
  kcal?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  focus?: string;
  maintenance?: number;
}

/* --- Nutrition-app tables. This app stores and round-trips them through the
       shared backup envelope but never interprets their contents. ---------- */

export interface NutritionDay {
  date: string;
  meals: unknown;
}

export interface SavedMeal {
  id: string;
  [key: string]: unknown;
}

/* --- Key-value settings: the editable equipment inventory (Phase 2). ------ */

export interface SettingRow {
  key: string;
  value: unknown;
}

/* --- Golf calendar (Phase 3). `planned` is a round on the calendar,
       `played` one that happened; both constrain grip work. ---------------- */

export interface GolfDay {
  date: string;
  status: 'planned' | 'played';
  holes?: 9 | 18;
  notes?: string;
}

/* --- free-exercise-db cache (§9). Populated in a later phase; the table
       exists now so the schema does not need a version bump later. -------- */

export interface FreeDbCache {
  id: string;
  json: unknown;
  imageBlobs?: Record<string, Blob>;
}
