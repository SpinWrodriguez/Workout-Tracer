import { db } from '../db/db';
import type {
  Block,
  BlockExercise,
  DaySlot,
  Exercise,
  GoalPlanInfo,
  MovementPattern,
  MuscleId,
  PlanRole,
} from '../db/types';
import { daysBetween, shiftIso, todayIso, weekStart } from './format';
import type { Weekday } from './golf';
import { workingRepRange } from './blockValidation';
import { isTimed } from './repUnit';
import { readSchedules, writeSchedule, type BlockSchedule } from './program';

/* -------------------------------------------------------------------------- */
/*  Goal plans — docs/GOAL-PLANS.md.                                          */
/*                                                                            */
/*  A plan is a block with a goal: three workouts fixed for its length and a  */
/*  target that changes week by week. The targets are written into the        */
/*  block's own rows once a week (syncPlanWeek), so the cards, the session,    */
/*  progression and the golf rule all read them without knowing what a plan   */
/*  is. Ending a plan takes its block out of the running and the app falls    */
/*  back to the block before it, shelf and all.                               */
/* -------------------------------------------------------------------------- */

export interface PhaseTarget {
  week: number;
  name: string;
  mainSets: number;
  accessorySets: number;
  main: { low: number; high: number };
  accessory: { low: number; high: number };
  /** Reps in reserve on working sets, as said to the lifter. */
  rir: string;
  /** About how many weighted sets each muscle should get this week. */
  setsPerMuscle: number;
  /** Golf power stays fast; it drops to two sets while the lifting peaks. */
  powerSets: number;
}

/** The Muscle preset, week by week. */
export const MUSCLE_PHASES: PhaseTarget[] = [
  { week: 1, name: 'Settle in', mainSets: 3, accessorySets: 2, main: { low: 10, high: 12 }, accessory: { low: 12, high: 15 }, rir: '3', setsPerMuscle: 10, powerSets: 3 },
  { week: 2, name: 'Settle in', mainSets: 3, accessorySets: 3, main: { low: 10, high: 12 }, accessory: { low: 12, high: 15 }, rir: '3', setsPerMuscle: 10, powerSets: 3 },
  { week: 3, name: 'Build', mainSets: 3, accessorySets: 3, main: { low: 8, high: 12 }, accessory: { low: 10, high: 15 }, rir: '2', setsPerMuscle: 12, powerSets: 3 },
  { week: 4, name: 'Build', mainSets: 4, accessorySets: 3, main: { low: 8, high: 12 }, accessory: { low: 10, high: 15 }, rir: '2', setsPerMuscle: 13, powerSets: 3 },
  { week: 5, name: 'Build', mainSets: 4, accessorySets: 3, main: { low: 8, high: 12 }, accessory: { low: 10, high: 15 }, rir: '2', setsPerMuscle: 14, powerSets: 3 },
  { week: 6, name: 'Push', mainSets: 4, accessorySets: 4, main: { low: 6, high: 10 }, accessory: { low: 8, high: 12 }, rir: '1–2', setsPerMuscle: 16, powerSets: 2 },
  { week: 7, name: 'Push', mainSets: 4, accessorySets: 4, main: { low: 6, high: 10 }, accessory: { low: 8, high: 12 }, rir: '1–2', setsPerMuscle: 16, powerSets: 2 },
  { week: 8, name: 'Lighter + test', mainSets: 2, accessorySets: 2, main: { low: 8, high: 10 }, accessory: { low: 10, high: 12 }, rir: '3', setsPerMuscle: 8, powerSets: 2 },
];

/** One place in a workout, and what is allowed to fill it. */
export interface SlotDef {
  key: string;
  label: string;
  role: PlanRole;
  patterns: MovementPattern[];
  /** At least one of these must be a primary muscle of whatever fills it. */
  muscles: MuscleId[];
  /** Power slots also take only explosive or rotational work. */
  explosive?: boolean;
  /** Tried in order when building; listed first when swapping. */
  candidates: string[];
}

export interface WorkoutDef {
  slot: DaySlot;
  name: string;
  weekday: Weekday;
  /** The day before golf: no high grip, no high spinal load, no finisher. */
  golfSafe: boolean;
  slots: SlotDef[];
}

/* The power and core slots open every workout: golf work goes first, while
   fresh, and is kept short so it does not eat into the muscle work. */
export const MUSCLE_WORKOUTS: WorkoutDef[] = [
  {
    slot: 'A',
    name: 'Lower + Push',
    weekday: 1,
    golfSafe: false,
    slots: [
      { key: 'power', label: 'Golf power', role: 'power', explosive: true, patterns: ['squat', 'hinge', 'rotation', 'push_v'], muscles: ['quads', 'glutes', 'obliques', 'front_delts'], candidates: ['bw_jump_squat', 'lm_scoop', 'lm_rotational_press'] },
      { key: 'core', label: 'Anti-rotation', role: 'core', patterns: ['core', 'rotation'], muscles: ['abs', 'obliques'], candidates: ['cb_pallof_press', 'cb_pallof_rotation', 'bw_side_plank'] },
      { key: 'lower', label: 'Lower', role: 'main', patterns: ['squat'], muscles: ['quads'], candidates: ['bb_back_squat', 'bb_front_squat', 'kb_goblet_squat', 'sm_squat'] },
      { key: 'push', label: 'Push', role: 'main', patterns: ['push_h'], muscles: ['chest'], candidates: ['bb_bench_press', 'sm_bench_press', 'bw_push_up'] },
      { key: 'single', label: 'One leg', role: 'accessory', patterns: ['squat'], muscles: ['quads', 'glutes'], candidates: ['kb_bulgarian_split', 'bw_split_squat', 'db_split_squat', 'kb_reverse_lunge', 'kb_step_up'] },
      { key: 'delts', label: 'Side delts', role: 'accessory', patterns: ['push_v'], muscles: ['side_delts'], candidates: ['cb_lateral_raise', 'db_lateral_raise'] },
      { key: 'triceps', label: 'Triceps', role: 'accessory', patterns: ['push_v', 'push_h'], muscles: ['triceps'], candidates: ['cb_overhead_triceps', 'cb_tricep_pushdown', 'cb_kickback'] },
      { key: 'calves', label: 'Calves', role: 'accessory', patterns: ['squat'], muscles: ['calves'], candidates: ['db_single_leg_calf_raise', 'sm_calf_raise', 'db_seated_calf_raise'] },
    ],
  },
  {
    slot: 'B',
    name: 'Pull + Hinge',
    weekday: 3,
    golfSafe: false,
    slots: [
      { key: 'power', label: 'Golf power', role: 'power', explosive: true, patterns: ['rotation', 'hinge', 'push_v'], muscles: ['obliques', 'glutes', 'front_delts'], candidates: ['lm_rotational_press', 'lm_scoop', 'cb_chop'] },
      { key: 'core', label: 'Adductors', role: 'core', patterns: ['core', 'carry', 'squat'], muscles: ['adductors'], candidates: ['bw_copenhagen_plank', 'cb_hip_adduction'] },
      { key: 'hinge', label: 'Hinge', role: 'main', patterns: ['hinge'], muscles: ['hamstrings', 'glutes'], candidates: ['bb_rdl', 'kb_single_leg_rdl', 'cb_pull_through'] },
      { key: 'pull', label: 'Vertical pull', role: 'main', patterns: ['pull_v'], muscles: ['lats'], candidates: ['bw_pull_up', 'bw_chin_up', 'bw_neutral_pull_up', 'cb_lat_pulldown'] },
      { key: 'row', label: 'Row', role: 'accessory', patterns: ['pull_h'], muscles: ['lats', 'upper_back'], candidates: ['cb_single_arm_row', 'cb_seated_row', 'sm_inverted_row', 'db_one_arm_row'] },
      { key: 'hamcurl', label: 'Hamstring curl', role: 'accessory', patterns: ['hinge'], muscles: ['hamstrings'], candidates: ['bw_nordic_curl', 'cb_leg_curl'] },
      { key: 'biceps', label: 'Biceps', role: 'accessory', patterns: ['pull_h', 'pull_v'], muscles: ['biceps'], candidates: ['db_incline_curl', 'bb_curl', 'cb_bicep_curl', 'db_hammer_curl'] },
    ],
  },
  {
    slot: 'C',
    name: 'Upper + Glutes',
    weekday: 5,
    golfSafe: true,
    slots: [
      { key: 'power', label: 'Golf primer', role: 'power', explosive: true, patterns: ['rotation'], muscles: ['obliques'], candidates: ['cb_chop', 'cb_lift', 'cb_punch'] },
      { key: 'core', label: 'Core', role: 'core', patterns: ['core', 'rotation'], muscles: ['obliques', 'abs'], candidates: ['bw_side_plank', 'cb_pallof_press', 'bw_captains_knee_raise'] },
      { key: 'glutes', label: 'Glutes', role: 'main', patterns: ['hinge'], muscles: ['glutes'], candidates: ['bb_hip_thrust', 'bw_glute_bridge', 'cb_pull_through'] },
      { key: 'press', label: 'Press', role: 'main', patterns: ['push_v'], muscles: ['front_delts'], candidates: ['db_shoulder_press', 'lm_press', 'bb_overhead_press'] },
      { key: 'lats', label: 'Lats', role: 'accessory', patterns: ['pull_v', 'pull_h'], muscles: ['lats'], candidates: ['db_pullover', 'sm_inverted_row', 'cb_straight_arm_pulldown', 'cb_single_arm_row'] },
      { key: 'chest', label: 'Chest', role: 'accessory', patterns: ['push_h'], muscles: ['chest'], candidates: ['cb_fly', 'bw_push_up', 'sm_incline_press'] },
      { key: 'reardelts', label: 'Rear delts', role: 'accessory', patterns: ['pull_h'], muscles: ['rear_delts'], candidates: ['cb_rear_delt_fly', 'cb_face_pull', 'bd_pull_apart'] },
      { key: 'calves', label: 'Calves', role: 'accessory', patterns: ['squat'], muscles: ['calves'], candidates: ['db_seated_calf_raise', 'sm_calf_raise', 'db_single_leg_calf_raise'] },
    ],
  },
];

export const MUSCLE_WEEKS = MUSCLE_PHASES.length;
export const GOAL_LABEL = { muscle: 'Muscle' } as const;

/* --- what fits where ------------------------------------------------------- */

/** Safe the day before golf: nothing grip-heavy, nothing heavy on the spine. */
export function isGolfSafe(exercise: Exercise): boolean {
  return exercise.gripLoad !== 'high' && exercise.spinalLoad !== 'high';
}

export function fitsSlot(exercise: Exercise, slot: SlotDef, golfSafe: boolean): boolean {
  if (exercise.isMobility || exercise.loadMode === 'rpe_only') return false;
  if (golfSafe && !isGolfSafe(exercise)) return false;
  if (slot.explosive && !exercise.isExplosive && exercise.pattern !== 'rotation') return false;
  if (!slot.patterns.includes(exercise.pattern)) return false;
  return exercise.primaryMuscles.some((muscle) => slot.muscles.includes(muscle));
}

/**
 * What a slot can be swapped to: its own candidates first, in their order,
 * then everything else that fits, by name. Only choosable exercises are passed
 * in, so retired and deleted ones never appear.
 */
export function slotOptions(slot: SlotDef, exercises: Exercise[], golfSafe: boolean): Exercise[] {
  const fitting = exercises.filter((exercise) => fitsSlot(exercise, slot, golfSafe));
  const rank = (exercise: Exercise) => {
    const at = slot.candidates.indexOf(exercise.id);
    return at === -1 ? slot.candidates.length : at;
  };
  return fitting.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** One workout's choice, slot by slot. Undefined where nothing fits. */
export interface DraftWorkout {
  def: WorkoutDef;
  picks: (string | undefined)[];
}

/**
 * Build my workouts: every slot takes the best choosable exercise that fits
 * it, never the same exercise twice in one workout. Deterministic, so pressing
 * it twice gives the same three workouts and the review is what changes them.
 */
export function buildPlanDraft(exercises: Exercise[]): DraftWorkout[] {
  return MUSCLE_WORKOUTS.map((def) => {
    const used = new Set<string>();
    const picks = def.slots.map((slot) => {
      const choice = slotOptions(slot, exercises, def.golfSafe).find((e) => !used.has(e.id));
      if (choice) used.add(choice.id);
      return choice?.id;
    });
    return { def, picks };
  });
}

/* --- the week's numbers ---------------------------------------------------- */

export function phaseFor(week: number): PhaseTarget {
  const clamped = Math.min(Math.max(1, week), MUSCLE_PHASES.length);
  return MUSCLE_PHASES[clamped - 1] as PhaseTarget;
}

/** Sets and range for one row this week, always inside the exercise's bounds. */
export function prescriptionFor(
  role: PlanRole,
  exercise: Exercise,
  phase: PhaseTarget,
): { targetSets: number; repRangeLow: number; repRangeHigh: number } {
  const range = (low: number, high: number) => workingRepRange(exercise, { low, high });
  let sets: number;
  let reps: { low: number; high: number };
  if (role === 'power') {
    sets = phase.powerSets;
    reps = isTimed(exercise) ? range(exercise.repMin, exercise.repMax) : range(5, 6);
  } else if (role === 'core') {
    sets = 2;
    reps = isTimed(exercise) ? range(20, 30) : range(8, 12);
  } else if (role === 'main') {
    sets = phase.mainSets;
    reps = isTimed(exercise) ? range(exercise.repMin, exercise.repMax) : range(phase.main.low, phase.main.high);
  } else {
    sets = phase.accessorySets;
    reps = isTimed(exercise)
      ? range(exercise.repMin, exercise.repMax)
      : range(phase.accessory.low, phase.accessory.high);
  }
  return { targetSets: sets, repRangeLow: reps.low, repRangeHigh: reps.high };
}

/** Said on the session screen while logging. */
export function effortCueFor(phase: PhaseTarget, def: WorkoutDef): string {
  const base = `Week ${phase.week} · ${phase.name}: ${phase.rir} reps in reserve on working sets.`;
  return def.golfSafe ? `${base} Golf tomorrow, so nothing to failure.` : base;
}

/* --- where a plan is in time ----------------------------------------------- */

export type PlanState = 'upcoming' | 'active' | 'finished' | 'ended';

export function planWeekOf(block: Block, date = todayIso()): number {
  return Math.floor(daysBetween(block.startDate, date) / 7) + 1;
}

export function planStateOf(block: Block, date = todayIso()): PlanState | undefined {
  if (!block.plan) return undefined;
  if (block.plan.endedAt) return 'ended';
  if (date < block.startDate) return 'upcoming';
  if (date > block.endDate) return 'finished';
  return 'active';
}

/**
 * The block the app works in today. Newest first, skipping a plan that has
 * been ended and one that has not started yet: until its Monday comes, the
 * old block and its shelf carry on as they were.
 */
export function currentBlockOf(blocks: Block[], date = todayIso()): Block | undefined {
  const sorted = [...blocks].sort((a, b) => b.startDate.localeCompare(a.startDate));
  return (
    // A plan that has started and not been ended outranks any free-form block,
    // whatever their start dates say: it is what the lifter chose to follow.
    sorted.find((block) => block.plan && !block.plan.endedAt && block.startDate <= date) ??
    sorted.find((block) => !block.plan?.endedAt && block.startDate <= date) ??
    sorted.find((block) => !block.plan?.endedAt) ??
    sorted[0]
  );
}

export async function readCurrentBlock(date = todayIso()): Promise<Block | undefined> {
  return currentBlockOf(await db.block.toArray(), date);
}

/** A plan that is booked but has not reached its start date. */
export async function readUpcomingPlan(date = todayIso()): Promise<Block | undefined> {
  return (await db.block.toArray()).find((block) => planStateOf(block, date) === 'upcoming');
}

/** The Monday a plan started today would begin: this week's, or the next one. */
export function defaultPlanStart(date = todayIso()): string {
  const monday = weekStart(date);
  return monday === date ? date : shiftIso(monday, 7);
}

/* --- starting, keeping current, ending ------------------------------------- */

export async function startPlan({
  start,
  draft,
  exercisesById,
}: {
  start: string;
  draft: DraftWorkout[];
  exercisesById: Map<string, Exercise>;
}): Promise<string> {
  const id = `plan_${start}`;
  const info: GoalPlanInfo = { goal: 'muscle', weeks: MUSCLE_WEEKS, appliedWeek: 1 };
  const block: Block = {
    id,
    startDate: start,
    endDate: shiftIso(start, MUSCLE_WEEKS * 7 - 1),
    focusMuscles: [],
    notes: 'Muscle plan, 8 weeks.',
    plan: info,
  };
  const phase = phaseFor(1);
  const rows: BlockExercise[] = [];
  const schedule: BlockSchedule = {};
  for (const { def, picks } of draft) {
    let order = 0;
    def.slots.forEach((slot, i) => {
      const exercise = picks[i] ? exercisesById.get(picks[i] as string) : undefined;
      if (!exercise) return;
      rows.push({
        blockId: id,
        exerciseId: exercise.id,
        daySlot: def.slot,
        role: slot.role,
        order: order++,
        ...prescriptionFor(slot.role, exercise, phase),
      });
    });
    schedule[def.slot] = {
      weekday: def.weekday,
      intensity: 'heavy',
      name: def.name,
      effortCue: effortCueFor(phase, def),
    };
  }
  await db.transaction('rw', db.block, db.blockExercise, async () => {
    await db.blockExercise.where('blockId').equals(id).delete();
    await db.block.put(block);
    await db.blockExercise.bulkPut(rows);
  });
  await writeSchedule(id, schedule);
  return id;
}

/**
 * Writes this week's targets into the plan's rows, once per week. Cheap to
 * call often: it returns at once when the week is already applied, so the
 * screens that read a workout call it before they read.
 */
export async function syncPlanWeek(block: Block | undefined, date = todayIso()): Promise<void> {
  if (!block?.plan || planStateOf(block, date) !== 'active') return;
  const week = Math.min(planWeekOf(block, date), block.plan.weeks);
  if (block.plan.appliedWeek === week) return;
  const phase = phaseFor(week);
  const rows = await db.blockExercise.where('blockId').equals(block.id).toArray();
  const exercisesById = new Map(
    (await db.exercise.bulkGet([...new Set(rows.map((row) => row.exerciseId))]))
      .filter((exercise): exercise is Exercise => exercise !== undefined)
      .map((exercise) => [exercise.id, exercise]),
  );
  const next = rows.map((row) => {
    const exercise = exercisesById.get(row.exerciseId);
    if (!exercise || !row.role) return row;
    return { ...row, ...prescriptionFor(row.role, exercise, phase) };
  });
  const schedule = (await readSchedules())[block.id] ?? {};
  for (const def of MUSCLE_WORKOUTS) {
    const day = schedule[def.slot];
    if (day) schedule[def.slot] = { ...day, effortCue: effortCueFor(phase, def) };
  }
  await db.transaction('rw', db.block, db.blockExercise, async () => {
    await db.blockExercise.bulkPut(next);
    await db.block.put({ ...block, plan: { ...block.plan, appliedWeek: week } as GoalPlanInfo });
  });
  await writeSchedule(block.id, schedule);
}

/**
 * End plan. The block keeps every logged set, stops being current, and the
 * block before it — the free-form shelf — is the app's again. A plan that had
 * not started is removed outright: nothing was logged against it.
 */
export async function endPlan(block: Block, date = todayIso()): Promise<void> {
  if (!block.plan) return;
  if (planStateOf(block, date) === 'upcoming') {
    await db.transaction('rw', db.block, db.blockExercise, async () => {
      await db.blockExercise.where('blockId').equals(block.id).delete();
      await db.block.delete(block.id);
    });
    return;
  }
  await db.block.put({
    ...block,
    endDate: date < block.endDate ? date : block.endDate,
    plan: { ...block.plan, endedAt: date },
  });
}
